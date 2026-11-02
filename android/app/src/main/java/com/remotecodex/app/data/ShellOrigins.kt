package com.remotecodex.app.data

/** Connection addresses are supplied by the owner, never inferred from a shipped host table. */
data class ShellOrigins(val webOrigin: String, val relayOrigin: String) {
    companion object {
        fun forAddress(serviceAddress: String, relayAddress: String = ""): ShellOrigins {
            val web = normalizeRelayUrl(serviceAddress)
            return ShellOrigins(web, normalizeRelayUrl(relayAddress).ifBlank { web })
        }

        /** Preserve persisted strings exactly. Legacy single-address installs confirm once. */
        fun stored(web: String?, relay: String?): StoredConnection =
            StoredConnection(
                web ?: relay.orEmpty(),
                relay ?: web.orEmpty(),
                (web == null || relay == null) && (!web.isNullOrBlank() || !relay.isNullOrBlank()),
            )
    }
}

data class StoredConnection(
    val webOrigin: String,
    val relayOrigin: String,
    val needsConfirmation: Boolean,
) {
    val configured: Boolean
        get() = webOrigin.isNotBlank() && relayOrigin.isNotBlank() && !needsConfirmation
}
