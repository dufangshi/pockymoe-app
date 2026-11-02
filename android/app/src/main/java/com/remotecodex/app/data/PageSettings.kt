package com.remotecodex.app.data

/** A page cannot change its own trust boundary or persist arbitrary settings. */
object PageSettings {
    fun validate(values: Map<String, Any?>) {
        require(values.keys.all { it in setOf("alertMode", "snoozeUntil") })
        if (values.containsKey("alertMode"))
            require(values["alertMode"] in setOf("petFirst", "system", "both"))
        values["snoozeUntil"]?.let { require(it is String && it.length <= 64) }
    }
}
