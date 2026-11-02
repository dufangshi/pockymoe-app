package com.remotecodex.app

import android.content.Context
import org.json.JSONObject

/** Local connection/error surfaces remain usable before the page can load. */
internal fun shellText(context: Context, chinese: String, english: String): String {
    val appearance =
        context
            .getSharedPreferences("mobile_shell", Context.MODE_PRIVATE)
            .getString("appearance", "{}")
    val locale =
        runCatching { JSONObject(appearance!!).optString("locale") }
            .getOrDefault("")
            .ifBlank { context.resources.configuration.locales[0].language }
    return if (locale.startsWith("zh")) chinese else english
}
