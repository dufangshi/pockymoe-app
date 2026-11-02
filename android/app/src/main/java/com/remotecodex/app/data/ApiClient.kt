package com.remotecodex.app.data

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import okhttp3.OkHttpClient
import okhttp3.Request

/** The shell reads only the generic durable account feed; product APIs stay in Web. */
class ApiClient(private val store: SessionStore) {
    private val http =
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build()

    suspend fun fetchWorkbench(): JsonObject =
        withContext(Dispatchers.IO) {
            val request =
                Request.Builder()
                    .url(store.relayUrl + "/relay/account/workbench")
                    .header("Authorization", "Bearer ${store.token}")
                    .build()
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful)
                    throw IOException("Relay workbench returned HTTP ${response.code}")
                Json.parseToJsonElement(
                        response.body?.string() ?: throw IOException("Empty workbench response")
                    )
                    .jsonObject
            }
        }
}
