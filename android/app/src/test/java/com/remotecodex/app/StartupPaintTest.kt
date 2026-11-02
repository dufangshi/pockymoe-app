package com.remotecodex.app

import org.junit.Assert.*
import org.junit.Test

class StartupPaintTest {
    @Test
    fun firstLaunchFollowsSystemAndRejectsTransparentCache() {
        assertEquals(0xFF17171A.toInt(), StartupPaint.select(null, true))
        assertEquals(0xFFFAFAF8.toInt(), StartupPaint.select(null, false))
        assertEquals(StartupPaint.dark, StartupPaint.select(0, true))
        assertEquals(StartupPaint.light, StartupPaint.select(0, false))
    }

    @Test
    fun aStoredDarkPageIsKeptWhenTheSystemIsLight() {
        val plum = 0xFF1B1022.toInt()
        assertEquals(plum, StartupPaint.select(plum, false))
        assertTrue(StartupPaint.isDark(plum))
        assertFalse(StartupPaint.isDark(StartupPaint.light))
    }

    @Test
    fun appearanceCannotReplaceTheCachedPaintBeforeItsVisualFence() {
        val paint = FirstPaintState(StartupPaint.dark)
        paint.begin()
        paint.documentCommitted()
        assertFalse(paint.canReveal)
        assertFalse(paint.appearance(StartupPaint.light))
        assertEquals(StartupPaint.dark, paint.color)
        assertTrue(paint.canReveal)
        assertTrue(paint.confirm(paint.generation))
        assertEquals(StartupPaint.light, paint.color)
        assertFalse(paint.confirm(paint.generation))
    }

    @Test
    fun staleDocumentCallbacksCannotRevealANewerNavigation() {
        val paint = FirstPaintState(StartupPaint.dark)
        paint.begin()
        paint.appearance(StartupPaint.light)
        paint.documentCommitted()
        val old = paint.generation
        paint.begin()
        paint.appearance(StartupPaint.dark)
        paint.documentCommitted()
        assertFalse(paint.confirm(old))
        assertFalse(paint.ready)
        assertTrue(paint.confirm(paint.generation))
        assertTrue(paint.appearance(StartupPaint.light))
        assertEquals(StartupPaint.light, paint.color)
    }

    @Test
    fun anOlderAppearanceFenceCannotRevealANewerPageColor() {
        val paint = FirstPaintState(StartupPaint.dark)
        paint.begin()
        paint.documentCommitted()
        paint.appearance(StartupPaint.light)
        val old = paint.revision
        paint.appearance(StartupPaint.dark)
        assertFalse(paint.confirm(paint.generation, old))
        assertEquals(StartupPaint.dark, paint.color)
        assertTrue(paint.confirm(paint.generation, paint.revision))
    }
}
