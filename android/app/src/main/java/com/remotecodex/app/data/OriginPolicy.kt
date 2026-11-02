package com.remotecodex.app.data

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** One canonical representation for bridge, navigation and connection checks. */
object OriginPolicy {
    fun normalize(raw: String): String? {
        val url = raw.trim().toHttpUrlOrNull() ?: return null
        if (
            url.username.isNotEmpty() ||
                url.password.isNotEmpty() ||
                url.query != null ||
                url.fragment != null ||
                url.encodedPath != "/"
        )
            return null
        return url.newBuilder().build().toString().removeSuffix("/")
    }

    fun allowed(raw: String, localHttp: Boolean): Boolean {
        val normalized = normalize(raw) ?: return false
        val url = normalized.toHttpUrlOrNull() ?: return false
        return url.scheme == "https" ||
            (localHttp &&
                url.scheme == "http" &&
                url.host in setOf("localhost", "127.0.0.1", "10.0.2.2"))
    }

    fun same(url: String, origin: String): Boolean {
        val a = url.toHttpUrlOrNull() ?: return false
        val b = origin.toHttpUrlOrNull() ?: return false
        return a.scheme == b.scheme && a.host == b.host && a.port == b.port
    }
}
