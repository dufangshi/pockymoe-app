package com.remotecodex.app.data

import android.content.Context
import android.content.SharedPreferences

class SessionStore(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("remote_codex", Context.MODE_PRIVATE)

    var relayUrl: String
        get() = ShellOrigins.forAddress(prefs.getString(KEY_URL, "").orEmpty()).relayOrigin
        set(value) = prefs.edit().putString(KEY_URL, normalizeRelayUrl(value)).apply()

    var webOrigin: String
        get() =
            prefs.getString("web_origin", null)
                ?: ShellOrigins.forAddress(prefs.getString(KEY_URL, "").orEmpty()).webOrigin
        set(value) = prefs.edit().putString("web_origin", normalizeRelayUrl(value)).apply()

    var token: String
        get() = prefs.getString(KEY_TOKEN, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_TOKEN, value).apply()

    val hasRelayUrl: Boolean
        get() = relayUrl.isNotBlank()

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
