package com.remotecodex.app.notify

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.remotecodex.app.BuildConfig
import com.remotecodex.app.MainActivity
import com.remotecodex.app.data.SessionStore
import com.remotecodex.app.shellText
import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject

object Notifications {
    const val CHANNEL_AGENT = "account-activity"
    const val WATCH_ID = 41
    const val EXTRA_DEVICE_ID = "deviceId"
    const val EXTRA_THREAD_ID = "threadId"
    const val EXTRA_RELAY_ORIGIN = "relayOrigin"
    private val activity = AccountActivity()
    private val metadata = ActivityMetadataCache()
    private var summary = AccountSummary("idle", emptyList(), 0, System.currentTimeMillis())
    private val localItems = mutableMapOf<String, AccountItem>()
    private var account = ""
    private var loaded = false
    private var relay = ""
    private var genericBody = ""
    private var lastEventKey: String? = null
    private var debugOverride = false
    private val handler = Handler(Looper.getMainLooper())
    private var expiry: Runnable? = null

    private fun itemJson(item: AccountItem) =
        JSONObject()
            .put("key", item.key)
            .put("deviceId", item.deviceId)
            .put("threadId", item.threadId)
            .put("title", item.title)
            .put("deviceName", item.deviceName)
            .put("workspaceLabel", item.workspaceLabel)
            .put("state", item.state)
            .put("since", item.since)
            .put("rootThreadKey", item.rootThreadKey)

    private fun item(v: JSONObject) =
        AccountItem(
            v.getString("key"),
            v.getString("deviceId"),
            v.getString("threadId"),
            v.optString("title", "线程运行中"),
            v.optString("deviceName"),
            v.optString("workspaceLabel"),
            v.getString("state"),
            v.getLong("since"),
            v.optString("rootThreadKey").takeUnless { it.isBlank() || it == "null" },
        )

    private fun restore(context: Context) {
        val currentRelay = SessionStore(context).relayUrl
        if (loaded && relay == currentRelay) return
        loaded = true
        relay = currentRelay
        localItems.clear()
        metadata.clear()
        genericBody = ""
        lastEventKey = null
        account = ""
        activity.lifetime = ActivityLifetime()
        runCatching {
            val saved =
                JSONObject(
                    context
                        .getSharedPreferences("account_activity", Context.MODE_PRIVATE)
                        .getString("snapshot", "{}")!!
                )
            if (saved.optString("relay") != relay) return
            account = saved.getString("accountId")
            genericBody = saved.optString("genericBody")
            lastEventKey = saved.optString("lastEventKey").takeIf { it.isNotBlank() }
            val entries = saved.getJSONArray("items")
            for (i in 0 until entries.length()) item(entries.getJSONObject(i)).let {
                localItems[it.key] = it
            }
            val names = saved.optJSONArray("metadata") ?: JSONArray()
            metadata.remember(
                account,
                (0 until names.length()).map { item(names.getJSONObject(it)) },
            )
            val keys = saved.getJSONArray("keys")
            activity.lifetime =
                ActivityLifetime(
                    account,
                    saved.optBoolean("started"),
                    saved.optLong("endedAt").takeIf { it > 0 },
                    (0 until keys.length()).map { keys.getString(it) }.toSet(),
                )
        }
    }

    private fun persist(context: Context) {
        val life = activity.lifetime
        val value =
            JSONObject()
                .put("relay", relay)
                .put("accountId", account)
                .put("started", life.started)
                .put("genericBody", genericBody)
                .put("lastEventKey", lastEventKey)
                .put("endedAt", life.endedAt ?: 0)
                .put("keys", JSONArray(life.keys.toList()))
                .put("items", JSONArray(localItems.values.map(::itemJson)))
                .put("metadata", JSONArray(metadata.snapshot().map(::itemJson)))
        context
            .getSharedPreferences("account_activity", Context.MODE_PRIVATE)
            .edit()
            .putString("snapshot", value.toString())
            .apply()
    }

    @Synchronized
    fun clear(context: Context) {
        expiry?.let(handler::removeCallbacks)
        expiry = null
        debugOverride = false
        lastEventKey = null
        loaded = false
        localItems.clear()
        metadata.clear()
        activity.lifetime = ActivityLifetime()
        genericBody = ""
        context
            .getSharedPreferences("account_activity", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply()
        context.getSystemService(NotificationManager::class.java).cancel(WATCH_ID)
    }

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        // This quiet account stream replaces the old high-importance per-turn channel.
        // Preserve a previous block/minimum setting without inheriting noisy defaults.
        val importance =
            minOf(
                manager.getNotificationChannel("agent-runs")?.importance
                    ?: NotificationManager.IMPORTANCE_LOW,
                NotificationManager.IMPORTANCE_LOW,
            )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_AGENT, "Pockymoe", importance)
        )
        manager.activeNotifications
            .filter { it.notification.channelId == "agent-runs" && it.id != WATCH_ID }
            .forEach { manager.cancel(it.id) }
    }

    @Synchronized
    fun sync(context: Context, snapshot: JSONObject) {
        if (BuildConfig.DEBUG && debugOverride && snapshot.optString("accountId") != "debug") return
        restore(context)
        val next = snapshot.getString("accountId")
        if (account != next) {
            localItems.clear()
            genericBody = ""
            lastEventKey = null
        }
        account = next
        localItems.clear()
        val entries = snapshot.getJSONArray("items")
        for (i in 0 until entries.length()) {
            val v = entries.getJSONObject(i)
            val item =
                AccountItem(
                    v.getString("key"),
                    v.getString("deviceId"),
                    v.getString("threadId"),
                    v.optString("rootThreadTitle").takeUnless { it == "null" || it.isBlank() }
                        ?: v.optString("title", "线程运行中"),
                    v.optString("deviceName"),
                    v.optString("workspaceLabel"),
                    v.getString("state"),
                    runCatching { Instant.parse(v.getString("since")).toEpochMilli() }
                        .getOrDefault(System.currentTimeMillis()),
                    v.optString("rootThreadKey").takeUnless { it == "null" || it.isBlank() },
                )
            localItems[item.key] = item
        }
        val names = localItems.values.toMutableList()
        val recent = snapshot.optJSONArray("recent") ?: JSONArray()
        for (i in 0 until recent.length()) {
            val v = recent.getJSONObject(i)
            names.add(
                AccountItem(
                    v.getString("key"),
                    v.getString("deviceId"),
                    v.getString("threadId"),
                    v.getString("title"),
                    v.optString("deviceName"),
                    v.optString("workspaceLabel"),
                    "idle",
                    System.currentTimeMillis(),
                )
            )
        }
        metadata.remember(account, names)
        refresh(context)
    }

    @Synchronized
    private fun refresh(context: Context) {
        // One ID is shared with startForeground: no second watcher notification.
        context
            .getSystemService(NotificationManager::class.java)
            .notify(WATCH_ID, watchNotification(context))
    }

    @Synchronized
    fun watchNotification(context: Context): Notification {
        restore(context)
        summary =
            activity.update(
                account,
                localItems.values.toList(),
                System.currentTimeMillis(),
                RemoteCodexForeground.isForeground,
            )
        if (summary.state == "idle" && activity.lifetime.endedAt == null && genericBody.isBlank())
            lastEventKey = null
        persist(context)
        expiry?.let(handler::removeCallbacks)
        activity.lifetime.endedAt?.let { end ->
            val appContext = context.applicationContext
            expiry =
                Runnable {
                        synchronized(this) {
                            genericBody = ""
                            lastEventKey = null
                        }
                        if (SessionStore(appContext).isSignedIn) refresh(appContext)
                        else clear(appContext)
                    }
                    .also {
                        handler.postDelayed(
                            it,
                            maxOf(
                                1,
                                end + AccountActivity.RETENTION_MS - System.currentTimeMillis(),
                            ),
                        )
                    }
        }
        val s = summary
        fun text(zh: String, en: String) = shellText(context, zh, en)
        val text =
            when (s.state) {
                "needsInput" -> text("${s.count} 个线程等待你处理", "${s.count} threads waiting for you")
                "failed" -> text("${s.count} 个线程失败", "${s.count} threads failed")
                "interrupted" -> text("${s.count} 个线程已中断", "${s.count} threads interrupted")
                "running" ->
                    text(
                        "${s.items.count { it.state == "running" }} 个线程运行中",
                        "${s.items.count { it.state == "running" }} threads running",
                    )
                "completed" -> text("${s.count} 个线程已完成", "${s.count} threads completed")
                else -> text("正在接收线程事件", "Receiving thread events")
            }
        val first =
            (s.items.firstOrNull() ?: lastEventKey?.let(localItems::get))?.conversationTarget()
        val intent =
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                if (first != null) {
                    putExtra(EXTRA_DEVICE_ID, first.deviceId)
                    putExtra(EXTRA_THREAD_ID, first.threadId)
                }
                putExtra(EXTRA_RELAY_ORIGIN, SessionStore(context).relayUrl)
            }
        val pending =
            PendingIntent.getActivity(
                context,
                WATCH_ID,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val builder =
            Notification.Builder(context, CHANNEL_AGENT)
                .setSmallIcon(
                    when (s.state) {
                        "needsInput" -> com.remotecodex.app.R.drawable.status_waiting
                        "failed" -> com.remotecodex.app.R.drawable.status_failed
                        "interrupted" -> com.remotecodex.app.R.drawable.status_interrupted
                        "completed" -> com.remotecodex.app.R.drawable.status_completed
                        "idle" -> com.remotecodex.app.R.drawable.status_idle
                        else -> com.remotecodex.app.R.drawable.status_running
                    }
                )
                .setContentTitle(
                    first?.title?.ifBlank { text("线程运行中", "Thread running") }?.let(::middleTitle)
                        ?: "Pockymoe"
                )
                .setContentText(genericBody.ifBlank { text })
                .setSubText(text)
                .setContentIntent(pending)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_PROGRESS)
                .setStyle(
                    Notification.BigTextStyle()
                        .bigText(
                            s.items.take(3).joinToString("\n") {
                                "${it.title} · ${it.deviceName} · ${it.workspaceLabel}"
                            } +
                                (if (s.items.size > 3)
                                    text("\n其余 ${s.items.size - 3} 个", "\n${s.items.size - 3} more")
                                else "") +
                                "\n" +
                                genericBody.ifBlank { text }
                        )
                )
        if (s.state == "running") builder.setWhen(s.since).setUsesChronometer(true)
        if (Build.VERSION.SDK_INT >= 36 && s.state != "idle") {
            // System surfaces cannot animate the Web status ring; elapsed time conveys progress.
            builder
                .setStyle(
                    Notification.ProgressStyle()
                        .setStyledByProgress(false)
                        .setProgressIndeterminate(s.state == "running")
                )
                .setContentText(
                    s.items.take(3).joinToString(" · ") {
                        "${it.title} · ${it.deviceName} · ${it.workspaceLabel}"
                    } +
                        (if (s.items.size > 3)
                            text(" · 其余 ${s.items.size - 3} 个", " · ${s.items.size - 3} more")
                        else "")
                )
                .setColor(
                    when (s.state) {
                        "needsInput",
                        "interrupted" -> 0xFFB7791F.toInt()
                        "failed" -> 0xFFDC2626.toInt()
                        else -> 0xFF78716C.toInt()
                    }
                )
                .setShortCriticalText(
                    if (s.state == "needsInput") s.count.toString()
                    else if (s.state == "running") text("运行中", "Running")
                    else if (s.state == "completed") text("已完成", "Done")
                    else if (s.state == "interrupted") text("已中断", "Stopped")
                    else text("失败", "Failed")
                )
            if (Build.VERSION.SDK_INT_FULL >= Build.VERSION_CODES_FULL.BAKLAVA_1)
                builder.setRequestPromotedOngoing(true)
        }
        return builder.build()
    }

    @Synchronized
    fun agentFinished(
        context: Context,
        deviceId: String,
        threadId: String,
        state: String,
        body: String,
    ) {
        if (RemoteCodexForeground.isForeground || (BuildConfig.DEBUG && debugOverride)) return
        restore(context)
        genericBody = body
        val key = "$deviceId:$threadId"
        lastEventKey = key
        val old = localItems[key] ?: metadata[key]
        // Generic Relay text never replaces local thread titles or device names.
        localItems[key] =
            old?.copy(state = state, since = System.currentTimeMillis())
                ?: AccountItem(
                    key,
                    deviceId,
                    threadId,
                    shellText(context, "线程运行中", "Thread running"),
                    "",
                    "",
                    state,
                    System.currentTimeMillis(),
                )
        refresh(context)
    }

    fun debugState(context: Context, state: String) {
        if (!BuildConfig.DEBUG) return
        if (state == "clear") {
            clear(context)
            return
        }
        if (state !in setOf("running", "needsInput", "failed", "interrupted", "completed", "idle"))
            return
        debugOverride = true
        val now = System.currentTimeMillis()
        val entry =
            JSONObject()
                .put("key", "debug:thread")
                .put("deviceId", "debug")
                .put("threadId", "thread")
                .put("title", shellText(context, "线程运行中", "Thread running"))
                .put("deviceName", "AOSP")
                .put("workspaceLabel", "mobile-ws")
                .put("since", Instant.ofEpochMilli(now - 60_000).toString())
                .put("state", state)
        if (state == "idle") activity.lifetime = ActivityLifetime("debug")
        if (state in setOf("needsInput", "failed", "interrupted", "completed")) {
            entry.put("state", "running")
            sync(
                context,
                JSONObject().put("accountId", "debug").put("items", org.json.JSONArray().put(entry)),
            )
            entry.put("state", state)
        }
        sync(
            context,
            JSONObject()
                .put("accountId", "debug")
                .put("items", org.json.JSONArray().apply { if (state != "idle") put(entry) }),
        )
    }
}
