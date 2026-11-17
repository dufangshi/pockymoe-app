package com.remotecodex.app.notify

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationManagerCompat
import com.remotecodex.app.data.ApiClient
import com.remotecodex.app.data.SessionStore
import java.security.MessageDigest
import java.time.Instant
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*

/**
 * Poll the relay's durable completion feed, not plaintext device APIs/WebSockets. The latter cannot
 * read E2EE devices and also lose turns completed while offline.
 *
 * Only in the background: while MainActivity is started the page shows events live, so the loop
 * only re-reads the sign-in cookie. It stops while signed out or with notifications disabled.
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
            val startedAt = System.currentTimeMillis()
            var lastEventAt = 0L
            while (isActive) {
                // SPA sign-out does not reload the WebView. Observe its HttpOnly cookie locally
                // too.
                val cookie =
                    withContext(Dispatchers.Main) { com.remotecodex.app.SessionCookies.read(store) }
                if (store.token != cookie) {
                    Notifications.clear(this@AgentEventService)
                    store.token = cookie
                }
                if (!store.isSignedIn) {
                    Notifications.clear(this@AgentEventService)
                    stopSelf()
                    break
                }
                // Nothing could be shown. MainActivity starts the service again once allowed.
                if (
                    !NotificationManagerCompat.from(this@AgentEventService)
                        .areNotificationsEnabled()
                ) {
                    stopSelf()
                    break
                }
                val identity = store.relayUrl + "|" + store.token
                val key =
                    MessageDigest.getInstance("SHA-256")
                        .digest(identity.toByteArray())
                        .joinToString("") { "%02x".format(it) }
                val prefs = getSharedPreferences("notification_cursor", MODE_PRIVATE)
                val saved =
                    prefs.getLong("$key.since", 0).takeIf { it > 0 }
                        ?: System.currentTimeMillis().also {
                            prefs.edit().putLong("$key.since", it).apply()
                        }
                if (RemoteCodexForeground.isForeground) {
                    // No requests while visible; wake on leaving or to re-check the cookie.
                    withTimeoutOrNull(SIGN_OUT_CHECK_MS) {
                        RemoteCodexForeground.changes.first { !it }
                    }
                    // Wait one short interval first: a rotation's brief stop/start polls nothing.
                    if (!RemoteCodexForeground.isForeground) backgroundPause(pollInterval(0))
                    continue
                }
                // The paused loop marked nothing seen while the page showed events live, so events
                // from before the app last left the foreground are treated as already read.
                val since = maxOf(saved, RemoteCodexForeground.leftAt)
                if (since != saved) prefs.edit().putLong("$key.since", since).apply()
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
                        lastEventAt = System.currentTimeMillis()
                        seen.add(id)
                    }
                    // Keep the bounded feed's IDs only; event time handles expiry.
                    val retained =
                        events.mapNotNull { it.jsonObject["id"]?.jsonPrimitive?.content }.toSet()
                    prefs.edit().putStringSet("$key.seen", seen.intersect(retained)).apply()
                }
                val quietFor =
                    System.currentTimeMillis() -
                        maxOf(startedAt, lastEventAt, RemoteCodexForeground.leftAt)
                backgroundPause(pollInterval(quietFor))
            }
        }
    }

    /** Waits [ms], or less if the app comes to the foreground meanwhile. */
    private suspend fun backgroundPause(ms: Long) {
        withTimeoutOrNull(ms) { RemoteCodexForeground.changes.first { it } }
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
        // Local cookie read only, no request: SPA sign-out does not reload the WebView.
        private const val SIGN_OUT_CHECK_MS = 4_000L

        fun start(context: Context) {
            // The loop would stop at once; MainActivity.onResume retries after a permission change.
            if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
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

/** Whether MainActivity is started (visible), set from its onStart/onStop. */
object RemoteCodexForeground {
    private val state = MutableStateFlow(false)
    val changes: StateFlow<Boolean> = state.asStateFlow()

    /** Device time the app last left the foreground, 0 if it has not in this process. */
    @Volatile var leftAt = 0L
        private set

    var isForeground: Boolean
        get() = state.value
        set(value) {
            if (state.value && !value) leftAt = System.currentTimeMillis()
            state.value = value
        }
}

/**
 * Background poll interval after [quietMs] without an event or a visit to the app. 4 s is the
 * latency users know, and a turn started just before leaving usually ends within minutes, so stay
 * at 4 s for 2 minutes, then 10 s until 10 minutes, 30 s until 30 minutes and a steady 60 s after
 * that. That is about 150 requests in the first background hour and 60 an hour later, instead of
 * 900 an hour, and a notification is at most about a minute late.
 */
internal fun pollInterval(quietMs: Long): Long =
    when {
        quietMs < 2 * 60_000L -> 4_000L
        quietMs < 10 * 60_000L -> 10_000L
        quietMs < 30 * 60_000L -> 30_000L
        else -> 60_000L
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
