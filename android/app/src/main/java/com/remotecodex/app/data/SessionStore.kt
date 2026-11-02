package com.remotecodex.app.data

import android.content.Context
import android.content.SharedPreferences

class SessionStore(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("remote_codex", Context.MODE_PRIVATE)

    var relayUrl: String
        get() = prefs.getString(KEY_URL, null) ?: prefs.getString("web_origin", "").orEmpty()
        set(value) = prefs.edit().putString(KEY_URL, normalizeRelayUrl(value)).apply()

    var webOrigin: String
        get() = prefs.getString("web_origin", null) ?: relayUrl
        set(value) = prefs.edit().putString("web_origin", normalizeRelayUrl(value)).apply()

    var token: String
        get() = prefs.getString(KEY_TOKEN, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_TOKEN, value).apply()

    val connection: StoredConnection
        get() =
            ShellOrigins.stored(prefs.getString("web_origin", null), prefs.getString(KEY_URL, null))

    val hasRelayUrl: Boolean
        get() = connection.configured

    val isSignedIn: Boolean
        get() = token.isNotBlank()

    companion object {
        private const val KEY_URL = "relay_url"
        private const val KEY_TOKEN = "relay_token"
    }
}

fun normalizeRelayUrl(raw: String): String {
    var value = raw.trim()
    if (value.isEmpty()) return ""
    if (!value.contains("://")) {
        value = "https://$value"
    }
    return value.trimEnd('/')
}
