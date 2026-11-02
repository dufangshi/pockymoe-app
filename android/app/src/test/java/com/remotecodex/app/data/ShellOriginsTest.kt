package com.remotecodex.app.data

import org.junit.Assert.*
import org.junit.Test

class ShellOriginsTest {
    @Test
    fun emptyStorageHasNoDefaultConnection() {
        val value = ShellOrigins.stored(null, null)
        assertEquals("", value.webOrigin)
        assertEquals("", value.relayOrigin)
        assertFalse(value.configured)
        assertFalse(value.needsConfirmation)
    }

    @Test
    fun anEnteredServiceAddressIsUsedForBothUnlessRelayIsSpecified() {
        assertEquals(
            ShellOrigins("https://app.example.com", "https://app.example.com"),
            ShellOrigins.forAddress("app.example.com/"),
        )
        assertEquals(
            ShellOrigins("https://app.example.com", "https://relay.example.com"),
            ShellOrigins.forAddress("https://app.example.com", "https://relay.example.com"),
        )
    }

    @Test
    fun storedPairsAreNeverRewritten() {
        val web = "https://custom.example.test:8443/"
        val relay = "https://api.example.test:9443/"
        val value = ShellOrigins.stored(web, relay)
        assertEquals(web, value.webOrigin)
        assertEquals(relay, value.relayOrigin)
        assertTrue(value.configured)
        assertFalse(value.needsConfirmation)
    }

    @Test
    fun aLegacySingleAddressIsPreservedAndRequestsConfirmation() {
        val original = "https://legacy.example.test:8443/"
        val value = ShellOrigins.stored(null, original)
        assertEquals(original, value.webOrigin)
        assertEquals(original, value.relayOrigin)
        assertTrue(value.needsConfirmation)
        assertFalse(value.configured)
        assertTrue(ShellOrigins.stored(original, null).needsConfirmation)
        assertTrue(ShellOrigins.stored(original, original).configured)
    }

    @Test
    fun arbitrarySelfHostedOriginsHaveNoSpecialMapping() {
        assertEquals(
            ShellOrigins("http://127.0.0.1:19892", "http://127.0.0.1:19890"),
            ShellOrigins.forAddress("http://127.0.0.1:19892/", "http://127.0.0.1:19890/"),
        )
    }
}
