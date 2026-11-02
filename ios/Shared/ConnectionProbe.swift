import Foundation

struct ProbeDocument {
    let url: URL
    let status: Int
    let contentType: String
    let body: String
}

enum ConnectionFailure: Error, LocalizedError {
    case invalidAddress, unavailable, notPockymoe, unsupportedHost
    var errorDescription: String? {
        switch self {
        case .invalidAddress: return "请输入有效的 HTTPS 服务地址"
        case .unavailable: return "无法连接此地址，请检查地址后重试"
        case .notPockymoe: return "此地址不是 Pockymoe 服务，请检查地址"
        case .unsupportedHost: return "此网页域名未加入本 App 的构建配置"
        }
    }
}

struct ConnectionProbe {
    typealias Fetch = (URL) async throws -> ProbeDocument
    let fetch: Fetch

    func discover(service: String, relay: String = "") async throws -> ServiceConfiguration {
        guard let entered = ServiceConfiguration.validOrigin(service),
              relay.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || ServiceConfiguration.validOrigin(relay) != nil else { throw ConnectionFailure.invalidAddress }
        let document: ProbeDocument
        do { document = try await fetch(entered.appendingPathComponent("")) }
        catch { throw ConnectionFailure.unavailable }
        guard (200..<300).contains(document.status), Self.isPockymoe(document),
              let final = ServiceConfiguration.validOrigin(Self.origin(document.url)) else { throw ConnectionFailure.notPockymoe }
        let override = relay.trimmingCharacters(in: .whitespacesAndNewlines)
        let relayOrigin = override.isEmpty ? entered.absoluteString : override
        guard let pair = ServiceConfiguration(service: final.absoluteString, relay: relayOrigin) else { throw ConnectionFailure.invalidAddress }
        return pair
    }

    static func origin(_ url: URL) -> String {
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        parts?.path = ""; parts?.query = nil; parts?.fragment = nil
        return parts?.url?.absoluteString ?? ""
    }

    static func isPockymoe(_ page: ProbeDocument) -> Bool {
        let html = page.body.lowercased()
        return page.contentType.lowercased().contains("text/html") &&
            html.contains("pockymoe") && (html.contains("id=\"root\"") || html.contains("id='root'")) &&
            html.contains("<script")
    }
}

// Ephemeral, unauthenticated, bounded discovery. Never use the WebView's cookies
// or a persisted native token to probe an address supplied by the person.
final class ConnectionProbeTransport: NSObject, URLSessionDataDelegate {
    private var task: URLSessionDataTask?
    private var session: URLSession?
    private var continuation: CheckedContinuation<ProbeDocument, Error>?
    private var bytes = Data()
    private var response: HTTPURLResponse?
    private var redirects = 0
    private let maximum = 2 * 1024 * 1024

    static func fetch(_ url: URL) async throws -> ProbeDocument {
        try await ConnectionProbeTransport().load(url)
    }
    private func load(_ url: URL) async throws -> ProbeDocument {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let configuration = URLSessionConfiguration.ephemeral
            configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
            configuration.httpShouldSetCookies = false
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            configuration.timeoutIntervalForRequest = 8; configuration.timeoutIntervalForResource = 12
            let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            self.session = session
            var request = URLRequest(url: url)
            request.httpShouldHandleCookies = false
            task = session.dataTask(with: request); task?.resume()
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard redirects < 4, let url = request.url,
              url.user == nil, url.password == nil,
              ServiceConfiguration.validOrigin(ConnectionProbe.origin(url)) != nil else { completionHandler(nil); return }
        redirects += 1
        var clean = request; clean.httpShouldHandleCookies = false
        for header in ["Authorization", "Cookie", "Proxy-Authorization"] { clean.setValue(nil, forHTTPHeaderField: header) }
        completionHandler(clean)
    }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        completionHandler(challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust ? .performDefaultHandling : .cancelAuthenticationChallenge, nil)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse, response.expectedContentLength <= maximum else { completionHandler(.cancel); return }
        self.response = response; completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if bytes.count + data.count > maximum { dataTask.cancel() } else { bytes.append(data) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        defer { continuation = nil; session.finishTasksAndInvalidate(); self.session = nil }
        guard let continuation else { return }
        if let error { continuation.resume(throwing: error); return }
        guard let response, let url = response.url else { continuation.resume(throwing: ConnectionFailure.unavailable); return }
        continuation.resume(returning: .init(url: url, status: response.statusCode, contentType: response.value(forHTTPHeaderField: "Content-Type") ?? "", body: String(data: bytes, encoding: .utf8) ?? ""))
    }
}
