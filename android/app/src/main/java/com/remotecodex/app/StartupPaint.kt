package com.remotecodex.app

/** Opaque paint used before the page has produced a visible frame. */
internal object StartupPaint {
    val dark = 0xFF17171A.toInt()
    val light = 0xFFFAFAF8.toInt()

    fun select(saved: Int?, systemDark: Boolean): Int =
        saved?.takeIf { it ushr 24 == 255 } ?: if (systemDark) dark else light

    fun isDark(color: Int): Boolean =
        299 * (color shr 16 and 255) + 587 * (color shr 8 and 255) + 114 * (color and 255) < 128000
}

/** A commit is not enough: wait for page appearance and its visual-state fence. */
internal class FirstPaintState(initial: Int) {
    var color = initial
        private set

    var generation = 0L
        private set

    var ready = false
        private set

    var committed = false
        private set

    private var pending: Int? = null
    var revision = 0
        private set

    val canReveal: Boolean
        get() = committed && pending != null && !ready

    fun begin() {
        generation++
        ready = false
        committed = false
        pending = null
    }

    fun documentCommitted() {
        committed = true
    }

    fun appearance(color: Int): Boolean {
        if (ready) {
            this.color = color
            return true
        }
        pending = color
        revision++
        return false
    }

    fun fallback(color: Int) {
        if (!ready) this.color = color
    }

    fun confirm(request: Long, appearance: Int = revision): Boolean {
        if (request != generation || appearance != revision || !canReveal) return false
        color = pending!!
        pending = null
        ready = true
        return true
    }
}
