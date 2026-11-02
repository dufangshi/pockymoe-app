import Foundation

struct ServiceConfiguration: Equatable {
    let webOrigin: String
    let relayOrigin: String

    init?(service: String, relay: String = "") {
        guard let web = Self.validOrigin(service) else { return nil }
        let rawRelay = relay.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let relay = rawRelay.isEmpty ? web : Self.validOrigin(rawRelay) else { return nil }
        webOrigin = web.absoluteString
        relayOrigin = relay.absoluteString
    }

    static func stored(in defaults: UserDefaults) -> ServiceConfiguration? {
        // Keep the existing preference key: existing installations retain their service.
        guard let service = defaults.string(forKey: "relay_url") else { return nil }
        return Self(service: service, relay: defaults.string(forKey: "shell.relayOrigin") ?? "")
    }

    func save(in defaults: UserDefaults) {
        defaults.set(webOrigin, forKey: "relay_url")
        defaults.set(relayOrigin, forKey: "shell.relayOrigin")
    }

    static func validOrigin(_ raw: String) -> URL? {
        guard let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = url.host, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, ["", "/"].contains(url.path) else { return nil }
        let scheme = url.scheme?.lowercased()
        if scheme != "https" {
            #if DEBUG
            guard scheme == "http", ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host) else { return nil }
            #else
            return nil
            #endif
        }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.scheme = scheme
        components?.host = host.lowercased()
        components?.path = ""
        if url.port == (scheme == "https" ? 443 : 80) { components?.port = nil }
        return components?.url
    }
}
