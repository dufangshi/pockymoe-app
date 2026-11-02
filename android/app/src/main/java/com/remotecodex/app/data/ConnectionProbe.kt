package com.remotecodex.app.data

import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

/** No cookie jar, authenticators or redirects inherited from the signed-in WebView. */
class ConnectionProbe(private val localHttp: Boolean, private val observe: (String) -> Unit = {}) {
    private val http =
        OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .callTimeout(12, TimeUnit.SECONDS)
            .build()

    fun connect(address: String, relayOverride: String = ""): ShellOrigins {
        require(OriginPolicy.allowed(address, localHttp))
        require(relayOverride.isBlank() || OriginPolicy.allowed(relayOverride, localHttp))
        val typed = OriginPolicy.normalize(address)!!
        var target = typed.toHttpUrl()
        repeat(6) {
            require(
                OriginPolicy.allowed(
                    target
                        .newBuilder()
                        .encodedPath("/")
                        .query(null)
                        .fragment(null)
                        .build()
                        .toString(),
                    localHttp,
                )
            )
            val request = Request.Builder().url(target).header("Accept", "text/html").build()
            observe(target.toString())
            http.newCall(request).execute().use { response ->
                if (response.code in setOf(301, 302, 303, 307, 308)) {
                    target =
                        target.resolve(
                            response.header("Location") ?: throw IOException("Missing redirect")
                        ) ?: throw IOException("Invalid redirect")
                    // Reject embedded credentials and HTTPS downgrades before making the next
                    // request.
                    require(target.username.isEmpty() && target.password.isEmpty())
                    require(
                        target.scheme == "https" ||
                            (localHttp &&
                                target.host in setOf("localhost", "127.0.0.1", "10.0.2.2"))
                    )
                } else {
                    val html = response.peekBody(1024 * 1024).string()
                    if (
                        response.code >= 500 ||
                            response.code !in 200..499 ||
                            !response
                                .header("Content-Type")
                                .orEmpty()
                                .contains("text/html", true) ||
                            !Regex("<title[^>]*>\\s*Pockymoe\\s*</title>", RegexOption.IGNORE_CASE)
                                .containsMatchIn(html) ||
                            !html.contains("id=\"root\"")
                    )
                        throw IOException("Not a Pockymoe Web page")
                    return ShellOrigins(
                        OriginPolicy.normalize(
                            target
                                .newBuilder()
                                .encodedPath("/")
                                .query(null)
                                .fragment(null)
                                .build()
                                .toString()
                        )!!,
                        if (relayOverride.isBlank()) typed
                        else OriginPolicy.normalize(relayOverride)!!,
                    )
                }
            }
        }
        throw IOException("Too many redirects")
    }
}
