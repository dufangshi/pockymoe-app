package com.remotecodex.app

import android.content.Context
import org.json.JSONObject

/** Local connection/error surfaces remain usable before the page can load. */
internal fun shellLocale(context: Context): String {
    val appearance =
        context
            .getSharedPreferences("mobile_shell", Context.MODE_PRIVATE)
            .getString("appearance", "{}")
    return runCatching { JSONObject(appearance!!).optString("locale") }
        .getOrDefault("")
        .ifBlank { context.resources.configuration.locales[0].language }
}

internal fun shellText(context: Context, chinese: String, english: String): String =
    if (shellLocale(context).startsWith("zh", ignoreCase = true)) chinese else english
