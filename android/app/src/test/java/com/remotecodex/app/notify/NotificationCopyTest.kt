package com.remotecodex.app.notify

import org.junit.Assert.*
import org.junit.Test

class NotificationCopyTest {
    @Test
    fun eachLineContainsOnlyItsOwnFact() {
        for (locale in listOf("en", "zh-CN")) {
            val copy = NotificationCopy(locale)
            for (state in listOf("running", "needsInput", "failed", "interrupted")) {
                val lines = copy.lines(state, 1, "修复通知", "Mac", "工作区", 0)
                assertEquals("修复通知", lines.title)
                assertEquals("Mac · 工作区", lines.text)
                assertEquals(listOf(lines.text, lines.state).joinToString("\n"), lines.expandedText)
                assertFalse(lines.expandedText.contains(lines.title))
            }
        }
    }

    @Test
    fun chineseExpandedStateWordingMatchesTheDesign() {
        val copy = NotificationCopy("zh-CN")
        assertEquals("运行中", copy.stateLine("running", 0))
        assertEquals("还有 1 个线程在运行", copy.stateLine("running", 1))
        assertEquals("还有 2 个线程在运行", copy.stateLine("running", 2))
        assertEquals("等待你处理", copy.stateLine("needsInput", 2))
        assertEquals("运行失败", copy.stateLine("failed", 0))
        assertEquals("运行失败 · 还有 2 个线程在运行", copy.stateLine("failed", 2))
        assertEquals("已中断", copy.stateLine("interrupted", 2))
    }

    @Test
    fun englishOthersHaveCorrectSingularAndPlural() {
        val copy = NotificationCopy("en-US")
        assertEquals("Running", copy.stateLine("running", 0))
        assertEquals("1 other thread running", copy.stateLine("running", 1))
        assertEquals("2 other threads running", copy.stateLine("running", 2))
        assertEquals("Waiting for you", copy.stateLine("needsInput", 2))
        assertEquals("Run failed", copy.stateLine("failed", 0))
        assertEquals("Run failed · 1 other thread running", copy.stateLine("failed", 1))
        assertEquals("Run failed · 2 other threads running", copy.stateLine("failed", 2))
        assertEquals("Interrupted", copy.stateLine("interrupted", 2))
    }

    @Test
    fun zeroOthersAreNeverWritten() {
        for (locale in listOf("en", "zh-CN")) for (state in
            listOf("running", "needsInput", "failed", "interrupted")) {
            for (count in listOf(0, -1)) assertFalse(
                NotificationCopy(locale).stateLine(state, count).contains('0')
            )
        }
    }

    @Test
    fun completedCountIsTheTitleAndAppearsOnlyOnce() {
        for (locale in listOf("en", "zh-CN")) for (count in listOf(1, 2)) {
            val copy = NotificationCopy(locale)
            val lines = copy.lines("completed", count, "Old thread title", "Mac", "Workspace", 0)
            val expected =
                if (locale == "en") "$count ${if (count == 1) "thread" else "threads"} completed"
                else "$count 个线程已完成"
            assertEquals(expected, lines.title)
            assertEquals("Mac · Workspace", lines.text)
            assertEquals("", lines.state)
            assertEquals(lines.text, lines.expandedText)
            assertFalse(lines.expandedText.contains(expected))
            assertFalse(lines.expandedText.contains("Old thread title"))
        }
    }

    @Test
    fun missingTitlesFollowLocaleAndCapsulesAreUnchanged() {
        for (missing in listOf(null, "", "  ")) {
            assertEquals(
                "Thread running",
                NotificationCopy("en").lines("running", 1, missing, "", "", 0).title,
            )
            assertEquals(
                "线程运行中",
                NotificationCopy("zh-CN").lines("needsInput", 1, missing, "", "", 0).title,
            )
        }
        val chinese = NotificationCopy("zh-TW")
        assertEquals("Page-owned title", chinese.threadTitle("Page-owned title"))
        assertEquals("2", chinese.critical("needsInput", 2))
        assertEquals("已中断", chinese.critical("interrupted", 1))
        assertEquals("Running", NotificationCopy("en").critical("running", 1))
        assertEquals("Done", NotificationCopy("en").critical("completed", 1))
        assertEquals("Pockymoe", chinese.lines("idle", 0, null, "", "", 0).title)
    }
}
