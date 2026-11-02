import Foundation

struct LegacySessionCleanup {
    struct Revocation {
        let origin: URL
        let token: String
    }
    static func take(from defaults: UserDefaults) -> Revocation? {
        let token = defaults.string(forKey: "relay_token")
        defaults.removeObject(forKey: "relay_token")
        guard let token, !token.isEmpty, token.count <= 8192,
              let raw = defaults.string(forKey: "shell.relayOrigin") ?? defaults.string(forKey: "relay_url"), let origin = ServiceConfiguration.validOrigin(raw) else { return nil }
        return Revocation(origin: origin, token: token)
    }
}

final class LegacySessionRevoker: NSObject, URLSessionTaskDelegate {
    static func revoke(_ value: LegacySessionCleanup.Revocation) async {
        let delegate = LegacySessionRevoker()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
        configuration.timeoutIntervalForRequest = 8; configuration.timeoutIntervalForResource = 8
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        var request = URLRequest(url: value.origin.appendingPathComponent("relay/auth/logout"))
        request.httpMethod = "POST"; request.httpShouldHandleCookies = false
        request.setValue("Bearer \(value.token)", forHTTPHeaderField: "Authorization")
        _ = try? await session.data(for: request)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
