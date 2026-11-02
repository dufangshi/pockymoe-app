package com.remotecodex.app

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build

/** Persist only the starting-window theme, never an app-wide night-mode override. */
internal object StartupTheme {
    private fun prefs(context: Context) =
        context.getSharedPreferences("mobile_shell", Context.MODE_PRIVATE)

    fun systemDark(context: Context): Boolean {
        val global = Resources.getSystem().configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        return if (global == Configuration.UI_MODE_NIGHT_UNDEFINED)
            context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
                Configuration.UI_MODE_NIGHT_YES
        else global == Configuration.UI_MODE_NIGHT_YES
    }

    fun background(context: Context): Int =
        StartupPaint.select(
            prefs(context).takeIf { it.contains("background") }?.getInt("background", 0),
            systemDark(context),
        )

    fun remember(activity: Activity) {
        if (Build.VERSION.SDK_INT < 31) return
        val saved =
            prefs(activity)
                .takeIf { it.contains("background") }
                ?.getInt("background", 0)
                ?.takeIf { it ushr 24 == 255 }
        val theme =
            if (saved == null) "system" else if (StartupPaint.isDark(saved)) "dark" else "light"
        if (prefs(activity).getString("splashTheme", null) == theme) return
        // These resource names must remain stable: Android persists their names
        // and reads the selected splash before the next app process exists.
        activity.splashScreen.setSplashScreenTheme(
            when (theme) {
                "dark" -> R.style.Theme_RemoteCodex_StartupDark
                "light" -> R.style.Theme_RemoteCodex_StartupLight
                else -> Resources.ID_NULL
            }
        )
        prefs(activity).edit().putString("splashTheme", theme).apply()
        StartupTrace.event("persistedSplashTheme:$theme", background(activity))
    }
}
