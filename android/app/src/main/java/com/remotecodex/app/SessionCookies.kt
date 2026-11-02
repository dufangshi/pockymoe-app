package com.remotecodex.app

import android.webkit.CookieManager
import com.remotecodex.app.data.OriginPolicy
import com.remotecodex.app.data.SessionStore

/** Cookies stay native. A same-origin API proxy owns its cookie on the Web host. */
internal object SessionCookies {
    fun read(store: SessionStore): String {
        val candidates = listOf(store.webOrigin, store.relayUrl).distinct()
        val pinned =
            store.cookieOrigin.takeIf { saved -> candidates.any { OriginPolicy.same(saved, it) } }
        val origins = if (pinned != null) listOf(pinned) else candidates
        for (origin in origins) {
            val token =
                CookieManager.getInstance()
                    .getCookie(origin)
                    ?.split(';')
                    ?.map { it.trim() }
                    ?.firstOrNull { it.startsWith("remote_codex_relay_session=") }
                    ?.substringAfter('=')
                    .orEmpty()
            if (token.isNotBlank()) {
                store.cookieOrigin = origin
                return token
            }
        }
        return ""
    }
}
