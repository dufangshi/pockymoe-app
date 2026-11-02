package com.remotecodex.app.notify

import org.junit.Assert.*
import org.junit.Test

class AccountActivityTest {
    private fun item(key: String, state: String, since: Long = 100, root: String? = null) =
        AccountItem(
            key,
            "device",
            key.substringAfter(':'),
            key,
            "device",
            "workspace",
            state,
            since,
            root,
        )

    @Test
    fun waitingWinsAndAgentsCountWithTheirConversation() {
        val s =
            AccountActivity()
                .update(
                    "a",
                    listOf(
                        item("root", "running"),
                        item("child", "needsInput", root = "root"),
                        item("failed", "failed"),
                    ),
                    1000,
                )
        assertEquals("needsInput", s.state)
        assertEquals(1, s.count)
        assertEquals(2, s.items.size)
        assertEquals("root", s.items.first().title)
    }

    @Test
    fun earliestRunningTimeAndFailurePriority() {
        val a = AccountActivity()
        assertEquals(
            50L,
            a.update("a", listOf(item("one", "running"), item("two", "running", 50)), 1000).since,
        )
        assertEquals(
            "failed",
            a.update("a", listOf(item("one", "running"), item("two", "failed")), 1001).state,
        )
    }

    @Test
    fun completionExpiresAfterFifteenMinutesAndDoesNotCrossAccounts() {
        val a = AccountActivity()
        a.update("a", listOf(item("one", "running")), 1000)
        assertEquals("completed", a.update("a", listOf(item("one", "completed")), 2000).state)
        assertEquals("completed", a.update("a", emptyList(), 901999).state)
        assertEquals("idle", a.update("a", emptyList(), 902000).state)
        a.update("a", listOf(item("one", "running")), 1000000)
        assertEquals("idle", a.update("b", emptyList(), 1000001).state)
    }

    @Test
    fun waitingPreventsEndingAndHistoricalCompletionDoesNotStartActivity() {
        val a = AccountActivity()
        assertEquals("idle", a.update("a", listOf(item("old", "completed")), 1000).state)
        a.update("a", listOf(item("one", "running")), 1001)
        assertEquals("needsInput", a.update("a", listOf(item("one", "needsInput")), 1002).state)
    }

    @Test
    fun backgroundRunningCannotStartLiveUpdate() {
        val a = AccountActivity()
        assertEquals("idle", a.update("a", listOf(item("one", "running")), 1000, false).state)
        assertEquals("running", a.update("a", listOf(item("one", "running")), 1001, true).state)
        assertEquals(
            "needsInput",
            a.update("a", listOf(item("one", "needsInput")), 1002, false).state,
        )
    }

    @Test
    fun restoredLifetimeKeepsItsOriginalExpiryIncludingFailures() {
        val a = AccountActivity()
        a.update("a", listOf(item("one", "running")), 1000)
        assertEquals("failed", a.update("a", listOf(item("one", "failed")), 2000).state)
        val restored = AccountActivity(a.lifetime)
        assertEquals(
            "failed",
            restored.update("a", listOf(item("one", "failed")), 901999, false).state,
        )
        assertEquals(
            "idle",
            restored.update("a", listOf(item("one", "failed")), 902000, false).state,
        )
    }

    @Test
    fun sequentialConversationsCountOnceAndRunningTimerIgnoresFailureTime() {
        val a = AccountActivity()
        a.update("a", listOf(item("d:one", "running")), 1000)
        val s =
            a.update("a", listOf(item("d:one", "failed", 900), item("d:two", "running", 100)), 1100)
        assertEquals(900L, s.since)
        assertEquals(
            2,
            a.update("a", listOf(item("d:one", "completed"), item("d:two", "completed")), 1200)
                .count,
        )
    }

    @Test
    fun childNotificationTargetsItsRootConversation() {
        val a = AccountActivity()
        val s =
            a.update(
                "a",
                listOf(item("d:root", "running"), item("d:child", "needsInput", root = "d:root")),
                1000,
            )
        assertEquals("root", s.items.single().threadId)
    }

    @Test
    fun completionCountDoesNotIncludeHistoricalItems() {
        val a = AccountActivity()
        a.update("a", listOf(item("old", "completed"), item("current", "running")), 1000)
        assertEquals(1, a.update("a", emptyList(), 2000).count)
    }

    @Test
    fun pageNamesSurviveEmptySnapshotsButNotAnAccountSwitch() {
        val cache = ActivityMetadataCache()
        cache.remember("a", listOf(item("thread", "running")))
        cache.remember("a", emptyList())
        assertEquals("thread", cache["thread"]?.title)
        assertEquals("idle", cache["thread"]?.state)
        cache.remember("b", emptyList())
        assertNull(cache["thread"])
    }

    @Test
    fun metadataRestoresWithoutRestartingWorkAndRemainsBounded() {
        val cache = ActivityMetadataCache(2)
        cache.remember(
            "a",
            listOf(item("one", "running"), item("two", "needsInput"), item("three", "failed")),
        )
        assertNull(cache["one"])
        val restored = ActivityMetadataCache()
        restored.remember("a", cache.snapshot())
        assertEquals("two", restored["two"]?.title)
        assertEquals("idle", AccountActivity().update("a", restored.snapshot(), 1000).state)
    }

    @Test
    fun cachedChildOutcomeStillOpensItsConversation() {
        val child = item("d:child", "idle", root = "d:root")
        assertEquals("d", child.conversationTarget().deviceId)
        assertEquals("root", child.conversationTarget().threadId)
    }
}
