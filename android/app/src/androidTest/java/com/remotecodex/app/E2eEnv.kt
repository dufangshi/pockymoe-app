package com.remotecodex.app

import androidx.test.platform.app.InstrumentationRegistry
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import org.json.JSONObject

data class E2eEnv(
    val appRelayUrl: String,
    val webUrl: String,
    val hostRelayUrl: String,
    val username: String,
    val password: String,
    var token: String,
    val deviceId: String,
    val workspaceId: String,
    val deviceApi: String,
) {
    fun allowAllNotifications() {
        post(
            "$hostRelayUrl/relay/account/notifications/preferences",
            """{"scope":"all","devices":[],"workspaces":[]}""",
            "PUT",
        )
    }

    fun fixtureEvent(type: String, threadId: String) {
        post(
            "$deviceApi/e2e/events",
            JSONObject().put("type", type).put("threadId", threadId).toString(),
        )
    }

    fun startThreadAndPrompt(): CreatedThread {
        val title = "Android mobile integration ${UUID.randomUUID().toString().take(6)}"
        val thread =
            post(
                "$deviceApi/threads/start",
                """{"workspaceId":"$workspaceId","title":"$title","provider":"codex","model":"ios-e2e-stream","approvalMode":"yolo"}""",
            )
        val id =
            thread
                .optString("id")
                .ifBlank { thread.optJSONObject("thread")?.optString("id") }
                .orEmpty()
        post("$deviceApi/threads/$id/prompt", """{"prompt":"hello, reply me with hello"}""")
        return CreatedThread(id, title)
    }

    private fun post(url: String, body: String, method: String = "POST"): JSONObject {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.doOutput = true
        connection.setRequestProperty("content-type", "application/json")
        if (token.isNotBlank()) {
            connection.setRequestProperty("authorization", "Bearer $token")
        }
        connection.outputStream.use { it.write(body.toByteArray()) }
        val text = connection.inputStream.bufferedReader().readText()
        return if (text.isBlank()) JSONObject() else JSONObject(text)
    }

    companion object {
        fun load(): E2eEnv {
            val args =
                JSONObject(
                    java.io
                        .File(InstrumentationRegistry.getArguments().getString("envFile")!!)
                        .readText()
                )
            val appRelayUrl = args.getString("relayUrl")
            val hostRelayUrl = appRelayUrl
            val username = args.getString("username")
            val password = args.getString("password")
            val token = args.getString("token")
            val deviceId = args.getString("deviceId")
            val workspaceId = args.getString("workspaceId")
            val deviceApi = args.getString("deviceApi")
            return E2eEnv(
                appRelayUrl = appRelayUrl,
                webUrl = args.optString("webUrl", appRelayUrl),
                hostRelayUrl = hostRelayUrl,
                username = username,
                password = password,
                token = token,
                deviceId = deviceId,
                workspaceId = workspaceId,
                deviceApi = deviceApi,
            )
        }
    }
}

data class CreatedThread(val id: String, val title: String)
