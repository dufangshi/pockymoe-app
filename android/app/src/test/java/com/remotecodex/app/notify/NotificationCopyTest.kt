package com.remotecodex.app.notify

import org.junit.Assert.*
import org.junit.Test

class NotificationCopyTest {
    @Test
    fun englishStatesHaveSingularAndPluralForms() {
        val copy = NotificationCopy("en-US")
        for ((state, wording) in
            mapOf(
                "running" to "running",
                "needsInput" to "waiting for you",
                "failed" to "failed",
                "interrupted" to "interrupted",
                "completed" to "completed",
            )) {
            assertEquals("1 thread $wording", copy.summary(state, 1))
            assertEquals("2 threads $wording", copy.summary(state, 2))
            assertEquals(
                "1 thread $wording · Fix Android notifications",
                copy.headline(state, 1, "Fix Android notifications"),
            )
        }
    }

    @Test
    fun chineseStatesAndGenericBodiesContainNoEnglishProse() {
        val copy = NotificationCopy("zh-CN")
        val states =
            mapOf(
                "running" to "运行中",
                "needsInput" to "等待你处理",
                "failed" to "失败",
                "interrupted" to "已中断",
                "completed" to "已完成",
            )
        for ((state, wording) in states) {
            for (count in listOf(1, 2)) assertEquals(
                "$count 个线程$wording",
                copy.summary(state, count),
            )
            assertEquals("1 个线程$wording · 修复通知", copy.headline(state, 1, "修复通知"))
            assertFalse(copy.genericBody(state).any { it in 'A'..'Z' || it in 'a'..'z' })
        }
    }

    @Test
    fun fallbackIsUsedOnlyForMissingTitlesAndFollowsTheCurrentLocale() {
        val english = NotificationCopy("en")
        val chinese = NotificationCopy("zh-TW")
        for (missing in listOf(null, "", "  ")) {
            assertEquals("Thread running", english.threadTitle(missing))
            assertEquals("线程运行中", chinese.threadTitle(missing))
        }
        assertEquals("Page-owned title", chinese.threadTitle("Page-owned title"))
        assertEquals("1 thread failed · Thread running", english.headline("failed", 1, null))
        assertEquals("1 个线程已完成 · 线程运行中", chinese.headline("completed", 1, null))
    }

    @Test
    fun waitingCountsCriticalLabelsAndWatcherAreLocalized() {
        assertEquals("2", NotificationCopy("en").critical("needsInput", 2))
        assertEquals("已中断", NotificationCopy("zh-CN").critical("interrupted", 1))
        assertEquals("Receiving thread events", NotificationCopy("en").summary("idle", 0))
        assertEquals("正在接收线程事件", NotificationCopy("zh-CN").summary("idle", 0))
        assertEquals("Pockymoe", NotificationCopy("en").headline("idle", 0, null))
    }
}
