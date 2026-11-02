package com.remotecodex.app.data

import org.junit.Assert.*
import org.junit.Test

class PageSettingsTest {
    @Test
    fun acceptsOnlyTheMobilePreferences() {
        PageSettings.validate(mapOf("alertMode" to "system", "snoozeUntil" to null))
        PageSettings.validate(mapOf("snoozeUntil" to "2030-01-01T00:00:00Z"))
        for (key in listOf("webOrigin", "relayOrigin", "unknown", "token", "__proto__")) {
            assertThrows(IllegalArgumentException::class.java) {
                PageSettings.validate(
                    mapOf("alertMode" to "both", key to "https://other.example.test")
                )
            }
        }
        assertThrows(IllegalArgumentException::class.java) {
            PageSettings.validate(mapOf("alertMode" to "other"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            PageSettings.validate(mapOf("snoozeUntil" to 17))
        }
    }
}
