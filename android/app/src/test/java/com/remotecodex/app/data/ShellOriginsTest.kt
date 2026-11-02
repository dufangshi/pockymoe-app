package com.remotecodex.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ShellOriginsTest {
    @Test
    fun publicWebHasASeparateRelay() {
        assertEquals(
            ShellOrigins(ShellOrigins.PUBLIC_WEB, ShellOrigins.PUBLIC_RELAY),
            ShellOrigins.forAddress(ShellOrigins.PUBLIC_WEB),
        )
    }

    @Test
    fun legacyRelayAddressesMigrateWithoutLoadingTheApiAsAWebPage() {
        for (address in
            listOf(ShellOrigins.PUBLIC_RELAY, "https://remote-codex.lnz-study.com")) assertEquals(
            ShellOrigins.PUBLIC_WEB,
            ShellOrigins.forAddress(address).webOrigin,
        )
    }

    @Test
    fun selfHostedOriginsStayLocal() {
        assertEquals(
            ShellOrigins("http://127.0.0.1:19890", "http://127.0.0.1:19890"),
            ShellOrigins.forAddress("http://127.0.0.1:19890/"),
        )
    }
}
