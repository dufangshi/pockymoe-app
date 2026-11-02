package com.remotecodex.app.notify

/** Notification prose is resolved at render time so cached metadata follows page locale changes. */
class NotificationCopy(locale: String) {
    private val chinese = locale.startsWith("zh", ignoreCase = true)

    fun choose(zh: String, en: String) = if (chinese) zh else en

    fun threadTitle(value: String?) =
        value?.takeIf { it.isNotBlank() } ?: choose("线程运行中", "Thread running")

    fun summary(state: String, count: Int): String {
        val threads = if (count == 1) "thread" else "threads"
        return when (state) {
            "running" -> choose("${count} 个线程运行中", "$count $threads running")
            "needsInput" -> choose("${count} 个线程等待你处理", "$count $threads waiting for you")
            "failed" -> choose("${count} 个线程失败", "$count $threads failed")
            "interrupted" -> choose("${count} 个线程已中断", "$count $threads interrupted")
            "completed" -> choose("${count} 个线程已完成", "$count $threads completed")
            else -> choose("正在接收线程事件", "Receiving thread events")
        }
    }

    fun headline(state: String, count: Int, title: String?) =
        if (state == "idle") "Pockymoe" else "${summary(state, count)} · ${threadTitle(title)}"

    fun critical(state: String, count: Int) =
        when (state) {
            "needsInput" -> count.toString()
            "running" -> choose("运行中", "Running")
            "failed" -> choose("失败", "Failed")
            "interrupted" -> choose("已中断", "Stopped")
            "completed" -> choose("已完成", "Done")
            else -> ""
        }

    fun more(count: Int) = choose("其余 $count 个", "$count more")

    fun genericBody(state: String) =
        when (state) {
            "running" -> choose("有线程正在运行，轻点打开线程。", "A thread is running. Tap to open this thread.")
            "idle" -> choose("正在接收线程事件", "Receiving thread events")
            "needsInput" -> choose("有线程需要你的输入，轻点处理。", "A thread needs your input. Tap to respond.")
            "failed" -> choose("智能体运行失败，轻点打开线程。", "Agent run failed. Tap to open this thread.")
            "interrupted" -> choose("线程已中断，轻点打开线程。", "Thread interrupted. Tap to open this thread.")
            else -> choose("智能体运行已完成，轻点打开线程。", "Agent run finished. Tap to open this thread.")
        }
}
