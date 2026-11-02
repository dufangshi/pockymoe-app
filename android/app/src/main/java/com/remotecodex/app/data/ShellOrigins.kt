package com.remotecodex.app.data

/** Same public origin pair as desktop; self-hosted relays serve their own Web UI. */
data class ShellOrigins(val webOrigin: String, val relayOrigin: String) {
    companion object {
        const val PUBLIC_WEB = "https://app.lnz-study.com"
        const val PUBLIC_RELAY = "https://remote.lnz-study.com"

        fun forAddress(address: String): ShellOrigins {
            val value = normalizeRelayUrl(address)
            return if (
                value in setOf(PUBLIC_WEB, PUBLIC_RELAY, "https://remote-codex.lnz-study.com")
            )
                ShellOrigins(PUBLIC_WEB, PUBLIC_RELAY)
            else ShellOrigins(value, value)
        }
    }
}
