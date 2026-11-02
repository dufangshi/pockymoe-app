package com.remotecodex.app.data

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class ConnectionProbeTest {
    private val html = "<html><title>Pockymoe</title><div id=\"root\"></div></html>"

    @Test
    fun redirectDiscoversWebWithoutSendingCredentials() {
        MockWebServer().use { relay ->
            MockWebServer().use { web ->
                relay.start()
                web.start()
                relay.enqueue(
                    MockResponse().setResponseCode(307).setHeader("Location", web.url("/"))
                )
                web.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody(html))
                val pair = ConnectionProbe(true).connect(relay.url("/").toString())
                assertEquals(web.url("/").toString().trimEnd('/'), pair.webOrigin)
                assertEquals(relay.url("/").toString().trimEnd('/'), pair.relayOrigin)
                for (request in listOf(relay.takeRequest(), web.takeRequest())) {
                    assertNull(request.getHeader("Authorization"))
                    assertNull(request.getHeader("Cookie"))
                }
            }
        }
    }

    @Test
    fun directWebAndExplicitRelayOverride() {
        MockWebServer().use { web ->
            web.start()
            repeat(2) {
                web.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody(html))
            }
            val typed = web.url("/").toString().trimEnd('/')
            assertEquals(ShellOrigins(typed, typed), ConnectionProbe(true).connect(typed))
            assertEquals(
                ShellOrigins(typed, "https://relay.example.test"),
                ConnectionProbe(true).connect(typed, "https://RELAY.example.test:443/"),
            )
        }
    }

    @Test
    fun rejectsNonPockymoeErrorsAndRedirectLoops() {
        MockWebServer().use { server ->
            server.start()
            for (response in
                listOf(
                    MockResponse().setBody("not Pockymoe"),
                    MockResponse()
                        .setResponseCode(503)
                        .setHeader("Content-Type", "text/html")
                        .setBody(html),
                )) {
                server.enqueue(response)
                assertThrows(Exception::class.java) {
                    ConnectionProbe(true).connect(server.url("/").toString())
                }
            }
            repeat(6) {
                server.enqueue(MockResponse().setResponseCode(307).setHeader("Location", "/"))
            }
            assertThrows(Exception::class.java) {
                ConnectionProbe(true).connect(server.url("/").toString())
            }
        }
    }

    @Test
    fun normalizesHostCaseAndDefaultPorts() {
        assertEquals(
            "https://app.example.test",
            OriginPolicy.normalize("HTTPS://APP.Example.Test:443/"),
        )
        assertTrue(
            OriginPolicy.same(
                "https://APP.example.test:443/relay-portal",
                "https://app.example.test",
            )
        )
        assertFalse(OriginPolicy.same("https://app.example.test:444", "https://app.example.test"))
        assertFalse(OriginPolicy.same("http://app.example.test", "https://app.example.test"))
        assertFalse(OriginPolicy.allowed("https://user:secret@app.example.test", false))
        assertFalse(OriginPolicy.allowed("http://localhost:19892", false))
        assertFalse(OriginPolicy.allowed("https://app.example.test/path", false))
    }

    @Test
    fun refusesRedirectCredentialsBeforeFollowing() {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(
                MockResponse()
                    .setResponseCode(307)
                    .setHeader("Location", "https://user:secret@app.example.test/")
            )
            assertThrows(Exception::class.java) {
                ConnectionProbe(true).connect(server.url("/").toString())
            }
            assertEquals(1, server.requestCount)
        }
    }
}
