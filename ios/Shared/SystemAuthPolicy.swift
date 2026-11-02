import Foundation

enum SystemAuthPolicy {
    static func allows(_ url: URL, service: String, relay: String) -> Bool {
        guard url.user == nil, url.password == nil, url.fragment == nil,
              let origin = ServiceConfiguration.validOrigin(ConnectionProbe.origin(url))?.absoluteString else { return false }
        if origin == service || origin == relay {
            return ["/relay/auth/oauth/google/start", "/relay/auth/oauth/github/start"].contains(url.path)
        }
        return url.scheme == "https" && (url.host == "accounts.google.com" || (url.host == "github.com" && url.path.hasPrefix("/login/")))
    }
}
