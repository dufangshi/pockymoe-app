package com.remotecodex.app.notify

import org.junit.Assert.*
import org.junit.Test

class PollIntervalTest {
    @Test
    fun backgroundPollingSlowsStepByStepToOneMinute() {
        assertEquals(4_000L, pollInterval(0))
        assertEquals(4_000L, pollInterval(2 * 60_000L - 1))
        assertEquals(10_000L, pollInterval(2 * 60_000L))
        assertEquals(10_000L, pollInterval(10 * 60_000L - 1))
        assertEquals(30_000L, pollInterval(10 * 60_000L))
        assertEquals(30_000L, pollInterval(30 * 60_000L - 1))
        assertEquals(60_000L, pollInterval(30 * 60_000L))
        assertEquals(60_000L, pollInterval(24 * 60 * 60_000L))
    }

    @Test
    fun leavingTheForegroundRecordsWhenItHappened() {
        RemoteCodexForeground.isForeground = true
        val before = System.currentTimeMillis()
        RemoteCodexForeground.isForeground = false
        val left = RemoteCodexForeground.leftAt
        assertTrue(left >= before)
        assertFalse(RemoteCodexForeground.changes.value)
        // Repeated stops without a start in between keep the first time.
        Thread.sleep(5)
        RemoteCodexForeground.isForeground = false
        assertEquals(left, RemoteCodexForeground.leftAt)
    }
}
