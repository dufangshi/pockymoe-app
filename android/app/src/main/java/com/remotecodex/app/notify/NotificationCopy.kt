package com.remotecodex.app.notify

/** One fact per line; cached metadata is formatted in the page's current locale. */
data class NotificationLines(val title: String, val text: String, val state: String) {
    val expandedText: String
        get() = listOf(text, state).filter(String::isNotBlank).joinToString("\n")
}

class NotificationCopy(locale: String) {
    private val chinese = locale.startsWith("zh", ignoreCase = true)

    private fun choose(zh: String, en: String) = if (chinese) zh else en

    fun threadTitle(value: String?) =
        value?.takeIf { it.isNotBlank() } ?: choose("线程运行中", "Thread running")

    fun completed(count: Int) =
        choose("$count 个线程已完成", "$count ${if (count == 1) "thread" else "threads"} completed")

    private fun others(count: Int) =
        choose(
            "还有 $count 个线程在运行",
            "$count other ${if (count == 1) "thread" else "threads"} running",
        )

    fun stateLine(state: String, otherRunning: Int): String {
        val remaining = otherRunning.coerceAtLeast(0)
        return when (state) {
            "running" -> if (remaining > 0) others(remaining) else choose("运行中", "Running")
            "needsInput" -> choose("等待你处理", "Waiting for you")
            "failed" ->
                listOf(choose("运行失败", "Run failed"), if (remaining > 0) others(remaining) else "")
                    .filter(String::isNotBlank)
                    .joinToString(" · ")
            "interrupted" -> choose("已中断", "Interrupted")
            else -> ""
        }
    }

    fun lines(
        state: String,
        count: Int,
        title: String?,
        device: String,
        workspace: String,
        otherRunning: Int,
    ): NotificationLines {
        if (state == "idle")
            return NotificationLines("Pockymoe", choose("正在接收线程事件", "Receiving thread events"), "")
        return NotificationLines(
            if (state == "completed") completed(count) else threadTitle(title),
            listOf(device, workspace).filter(String::isNotBlank).joinToString(" · "),
            stateLine(state, otherRunning),
        )
    }

    // Capsules have no thread title, so their compact labels/counts are unchanged.
    fun critical(state: String, count: Int) =
        when (state) {
            "needsInput" -> count.toString()
            "running" -> choose("运行中", "Running")
            "failed" -> choose("失败", "Failed")
            "interrupted" -> choose("已中断", "Stopped")
            "completed" -> choose("已完成", "Done")
            else -> ""
        }
}
