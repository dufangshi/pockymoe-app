package com.remotecodex.app

import org.json.JSONObject

/** DEBUG-only native observations for instrumentation; never exposed to the page or logs. */
internal object HostDiagnostics {
    data class Appearance(
        val effective: String,
        val pack: String,
        val background: String,
        val locale: String,
    )

    data class Item(val threadId: String, val title: String, val state: String)

    private val destinations = mutableSetOf<String>()
    private val feedback = mutableListOf<String>()
    @Volatile
    var appearance: Appearance? = null
        private set

    @Volatile
    var items: List<Item> = emptyList()
        private set

    @Volatile
    var activityCalls: Int = 0
        private set

    @Synchronized
    fun reset() {
        feedback.clear()
        destinations.clear()
        appearance = null
        items = emptyList()
        activityCalls = 0
    }

    @Synchronized
    fun network(url: String) {
        if (!BuildConfig.DEBUG) return
        val uri = android.net.Uri.parse(url)
        if (uri.scheme != "http" && uri.scheme != "https") return
        val port = uri.port.takeIf { it >= 0 } ?: if (uri.scheme == "https") 443 else 80
        if (destinations.size < 64) destinations.add("${uri.scheme}://${uri.host}:$port")
    }

    @Synchronized fun networkOrigins() = destinations.toSet()

    @Synchronized fun haptics() = feedback.toList()

    @Synchronized
    fun haptic(kind: String) {
        if (BuildConfig.DEBUG && feedback.size < 256) feedback.add(kind)
    }

    fun appearance(value: JSONObject) {
        if (BuildConfig.DEBUG)
            appearance =
                Appearance(
                    value.optString("effective"),
                    value.optString("pack"),
                    value.optString("background"),
                    value.optString("locale"),
                )
    }

    fun activity(value: JSONObject) {
        if (!BuildConfig.DEBUG) return
        val entries = value.optJSONArray("items")
        items =
            if (entries == null) emptyList()
            else
                (0 until entries.length()).map { i ->
                    val item = entries.getJSONObject(i)
                    Item(
                        item.optString("threadId"),
                        item.optString("rootThreadTitle").takeUnless {
                            it.isBlank() || it == "null"
                        } ?: item.optString("title"),
                        item.optString("state"),
                    )
                }
        activityCalls++
    }
}
