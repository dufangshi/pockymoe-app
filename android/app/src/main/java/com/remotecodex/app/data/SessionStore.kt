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

    var cookieOrigin: String
        get() = prefs.getString("cookie_origin", "").orEmpty()
        set(value) = prefs.edit().putString("cookie_origin", value).apply()

    var legacyProbeAttempted: Boolean
        get() = prefs.getBoolean("legacy_probe_attempted", false)
        set(value) = prefs.edit().putBoolean("legacy_probe_attempted", value).apply()

    val serviceAddress: String
        get() = prefs.getString("service_address", null) ?: connection.webOrigin

    fun connect(pair: ShellOrigins, address: String, preserveSession: Boolean) {
        prefs
            .edit()
            .putString(KEY_URL, pair.relayOrigin)
            .putString("web_origin", pair.webOrigin)
            .putString("service_address", address)
            .putBoolean("legacy_probe_attempted", true)
            .apply {
                if (!preserveSession) {
                    remove(KEY_TOKEN)
                    remove("cookie_origin")
                }
            }
            .apply()
    }

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
