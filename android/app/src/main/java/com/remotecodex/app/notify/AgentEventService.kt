package com.remotecodex.app.notify

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.webkit.CookieManager
import androidx.core.app.NotificationManagerCompat
import com.remotecodex.app.data.ApiClient
import com.remotecodex.app.data.SessionStore
import java.security.MessageDigest
import java.time.Instant
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

/**
 * Poll the relay's durable completion feed, not plaintext device APIs/WebSockets. The latter cannot
 * read E2EE devices and also lose turns completed while offline.
 */
class AgentEventService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannel(this)
        if (Build.VERSION.SDK_INT >= 29)
            startForeground(
                Notifications.WATCH_ID,
                Notifications.watchNotification(this),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        else startForeground(Notifications.WATCH_ID, Notifications.watchNotification(this))
        job = scope.launch {
            val store = SessionStore(this@AgentEventService)
            val api = ApiClient(store)
            while (isActive) {
                // SPA sign-out does not reload the WebView. Observe its HttpOnly cookie locally
                // too.
                val cookie =
                    withContext(Dispatchers.Main) {
                        CookieManager.getInstance()
                            .getCookie(store.relayUrl)
                            ?.split(';')
                            ?.map { it.trim() }
                            ?.firstOrNull { it.startsWith("remote_codex_relay_session=") }
                            ?.substringAfter('=')
                            .orEmpty()
                    }
                if (store.token != cookie) {
                    Notifications.clear(this@AgentEventService)
                    store.token = cookie
                }
                if (!store.isSignedIn) {
                    Notifications.clear(this@AgentEventService)
                    stopSelf()
                    break
                }
                val identity = store.relayUrl + "|" + store.token
                val key =
                    MessageDigest.getInstance("SHA-256")
                        .digest(identity.toByteArray())
                        .joinToString("") { "%02x".format(it) }
                val prefs = getSharedPreferences("notification_cursor", MODE_PRIVATE)
                val since =
                    prefs.getLong("$key.since", 0).takeIf { it > 0 }
                        ?: System.currentTimeMillis().also {
                            prefs.edit().putLong("$key.since", it).apply()
                        }
                runCatching {
                    val events =
                        api.fetchWorkbench()["notifications"]?.jsonArray ?: return@runCatching
                    if (identity != store.relayUrl + "|" + store.token) return@runCatching
                    val seen = prefs.getStringSet("$key.seen", emptySet()).orEmpty().toMutableSet()
                    for (entry in events.reversed()) {
                        val event = entry.jsonObject
                        val id = event["id"]?.jsonPrimitive?.content ?: continue
                        if (id in seen) continue
                        val at =
                            event["occurredAt"]?.jsonPrimitive?.content?.let {
                                Instant.parse(it).toEpochMilli()
                            } ?: continue
                        if (at < since) {
                            seen.add(id)
                            continue
                        }
                        val route =
                            threadRef(event["href"]?.jsonPrimitive?.content.orEmpty()) ?: continue
                        if (RemoteCodexForeground.isForeground) {
                            seen.add(id)
                            continue
                        }
                        if (
                            !NotificationManagerCompat.from(this@AgentEventService)
                                .areNotificationsEnabled()
                        )
                            continue
                        // The durable workbench feed exposes a generic outcome suffix, never use
                        // its title as content.
                        val outcome = event["title"]?.jsonPrimitive?.content.orEmpty()
                        val state =
                            when {
                                outcome.endsWith("needs input") -> "needsInput"
                                outcome.endsWith("failed") -> "failed"
                                else -> "completed"
                            }
                        val body =
                            when (state) {
                                "needsInput" -> "A thread needs your input. Click to respond."
                                "failed" -> "Agent run failed. Tap to open this thread."
                                else -> "Agent run finished. Tap to open this thread."
                            }
                        Notifications.agentFinished(
                            this@AgentEventService,
                            route.deviceId,
                            route.threadId,
                            state,
                            body,
                        )
                        seen.add(id)
                    }
                    // Keep the bounded feed's IDs only; event time handles expiry.
                    val retained =
                        events.mapNotNull { it.jsonObject["id"]?.jsonPrimitive?.content }.toSet()
                    prefs.edit().putStringSet("$key.seen", seen.intersect(retained)).apply()
                }
                delay(4_000)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY

    // Android 15 limits dataSync foreground services. Stop cleanly at that limit.
    override fun onTimeout(startId: Int, fgsType: Int) {
        stopSelf()
    }

    override fun onDestroy() {
        scope.cancel()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    companion object {
        fun start(context: Context) {
            val intent = Intent(context, AgentEventService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
            else context.startService(intent)
        }

        fun refresh(context: Context) = start(context)

        fun stop(context: Context) {
            context.stopService(Intent(context, AgentEventService::class.java))
        }
    }
}

data class OpenThreadRef(val deviceId: String, val threadId: String)

object RemoteCodexForeground {
    @Volatile var isForeground = false
}

internal fun threadRef(path: String): OpenThreadRef? {
    val parts = Uri.parse(path).pathSegments ?: return null
    if (
        parts.size != 4 ||
            parts[0] != "devices" ||
            parts[2] != "threads" ||
            parts[3] in setOf("new", "import")
    )
        return null
    return OpenThreadRef(parts[1], parts[3])
}
