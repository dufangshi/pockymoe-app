package com.remotecodex.app

import android.graphics.drawable.ColorDrawable
import android.os.SystemClock
import android.util.Log
import android.view.View

/** Paint/lifecycle timing only: no URLs, sessions or page contents. */
internal object StartupTrace {
    fun event(name: String, color: Int? = null, alpha: Float? = null) {
        if (BuildConfig.DEBUG)
            Log.i(
                "PockymoeStartup",
                "event=$name uptime=${SystemClock.uptimeMillis()} color=${color?.let { String.format("#%08x", it) } ?: "unknown"} alpha=${alpha ?: -1f}",
            )
    }

    fun color(view: View) = (view.background as? ColorDrawable)?.color
}
