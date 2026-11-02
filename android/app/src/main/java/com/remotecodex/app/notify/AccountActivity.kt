package com.remotecodex.app.notify

/** Only the page supplies display names. Relay events contain routing and generic outcomes. */
data class AccountItem(
    val key: String,
    val deviceId: String,
    val threadId: String,
    val title: String,
    val deviceName: String,
    val workspaceLabel: String,
    val state: String,
    val since: Long,
    val rootThreadKey: String? = null,
)

data class AccountSummary(
    val state: String,
    val items: List<AccountItem>,
    val count: Int,
    val since: Long,
)

data class ActivityLifetime(
    val accountId: String = "",
    val started: Boolean = false,
    val endedAt: Long? = null,
    val keys: Set<String> = emptySet(),
)

class AccountActivity(var lifetime: ActivityLifetime = ActivityLifetime()) {
    fun update(
        account: String,
        items: List<AccountItem>,
        now: Long,
        foreground: Boolean = true,
    ): AccountSummary {
        if (lifetime.accountId != account) lifetime = ActivityLifetime(account)
        val groups =
            items
                .groupBy { it.rootThreadKey ?: it.key }
                .map { (key, group) ->
                    val chosen = group.minBy { priority(it.state) }
                    val root = group.firstOrNull { it.key == key }
                    // Children never appear as separate conversations, including the tap target.
                    chosen.copy(
                        key = key,
                        threadId = root?.threadId ?: key.substringAfter(':'),
                        title = root?.title ?: chosen.title,
                    )
                }
        val active = groups.any { it.state == "needsInput" || it.state == "running" }
        if (!lifetime.started && foreground && items.any { it.state == "running" })
            lifetime = ActivityLifetime(account, true)
        if (!lifetime.started) return AccountSummary("idle", emptyList(), 0, now)
        if (active)
            lifetime =
                lifetime.copy(
                    endedAt = null,
                    keys =
                        lifetime.keys +
                            groups
                                .filter { it.state == "running" || it.state == "needsInput" }
                                .map { it.key },
                )
        else if (lifetime.endedAt == null) lifetime = lifetime.copy(endedAt = now)
        if (lifetime.endedAt?.let { now - it >= RETENTION_MS } == true) {
            lifetime = ActivityLifetime(account)
            return AccountSummary("idle", emptyList(), 0, now)
        }
        val visible =
            groups
                .filter { it.state in setOf("needsInput", "failed", "interrupted", "running") }
                .sortedWith(compareBy<AccountItem> { priority(it.state) }.thenBy { it.since })
        if (visible.isNotEmpty()) {
            val state = visible.first().state
            val since = visible.filter { it.state == state }.minOf { it.since }
            return AccountSummary(state, visible, visible.count { it.state == state }, since)
        }
        return AccountSummary("completed", groups, lifetime.keys.size, lifetime.endedAt ?: now)
    }

    private fun priority(state: String) =
        when (state) {
            "needsInput" -> 0
            "failed",
            "interrupted" -> 1
            "running" -> 2
            else -> 3
        }

    companion object {
        const val RETENTION_MS = 15 * 60_000L
    }
}

internal fun middleTitle(value: String, limit: Int = 48): String {
    val size = value.codePointCount(0, value.length)
    if (size <= limit) return value
    val side = (limit - 1) / 2
    return value.substring(0, value.offsetByCodePoints(0, side)) +
        "…" +
        value.substring(value.offsetByCodePoints(0, size - side))
}

/** Page-owned names outlive the active list, but never cross account boundaries. */
class ActivityMetadataCache(private val capacity: Int = 512) {
    private var account: String? = null
    private val entries = linkedMapOf<String, AccountItem>()

    fun remember(accountId: String, items: List<AccountItem>) {
        if (account != accountId) {
            clear()
            account = accountId
        }
        for (item in items) {
            entries.remove(item.key)
            entries[item.key] = item.copy(state = "idle")
            while (entries.size > capacity) entries.remove(entries.keys.first())
        }
    }

    operator fun get(key: String) = entries[key]

    fun snapshot() = entries.values.toList()

    fun clear() {
        account = null
        entries.clear()
    }
}

internal fun AccountItem.conversationTarget(): AccountItem {
    val root = rootThreadKey ?: return this
    return copy(
        key = root,
        deviceId = if (':' in root) root.substringBefore(':') else deviceId,
        threadId = root.substringAfter(':'),
    )
}
