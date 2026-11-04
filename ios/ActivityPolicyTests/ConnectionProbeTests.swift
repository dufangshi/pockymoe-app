import XCTest
@testable import ActivityPolicy

final class ConnectionProbeTests: XCTestCase {
    private let html = "<html><title>Pockymoe</title><div id=\"root\"></div><script src=\"/app.js\"></script></html>"
    func testRedirectKeepsEnteredRelayAndUsesFinalWeb() async throws {
        let probe = ConnectionProbe { url in
            XCTAssertEqual(url.host, "relay.example.test")
            return .init(url: URL(string: "https://web.example.test/")!, status: 200, contentType: "text/html; charset=utf-8", body: self.html)
        }
        let pair = try await probe.discover(service: "https://relay.example.test")
        XCTAssertEqual(pair.webOrigin, "https://web.example.test")
        XCTAssertEqual(pair.relayOrigin, "https://relay.example.test")
        let override = try await probe.discover(service: "https://relay.example.test", relay: "https://other.example.test")
        XCTAssertEqual(override.relayOrigin, "https://other.example.test")
    }
    func testDirectWebAndNonProductResponses() async throws {
        let probe = ConnectionProbe { .init(url: $0, status: 200, contentType: "text/html", body: self.html) }
        let pair = try await probe.discover(service: "https://web.example.test")
        XCTAssertEqual(pair.webOrigin, pair.relayOrigin)
        let bad = ConnectionProbe { .init(url: $0, status: 200, contentType: "text/html", body: "<html>Another product</html>") }
        do { _ = try await bad.discover(service: "https://other.example.test"); XCTFail("Non-Pockymoe must stay on the connection form") }
        catch { XCTAssertEqual(error as? ConnectionFailure, .notPockymoe) }
    }
    func testUnreachableAndInvalidInputNeverProduceConfiguration() async {
        let probe = ConnectionProbe { _ in throw URLError(.cannotConnectToHost) }
        do { _ = try await probe.discover(service: "https://missing.example.test"); XCTFail() }
        catch { XCTAssertEqual(error as? ConnectionFailure, .unavailable) }
        do { _ = try await probe.discover(service: "https://user:secret@example.test"); XCTFail() }
        catch { XCTAssertEqual(error as? ConnectionFailure, .invalidAddress) }
    }
    func testSystemAuthAllowsSeparateRelayButNotArbitraryOriginsOrRoutes() {
        let web = "https://web.example.test", relay = "https://relay.example.test"
        XCTAssertTrue(SystemAuthPolicy.allows(URL(string: relay + "/relay/auth/oauth/github/start?mobileId=fixture")!, service: web, relay: relay))
        XCTAssertTrue(SystemAuthPolicy.allows(URL(string: web + "/relay/auth/oauth/google/start")!, service: web, relay: relay))
        for path in ["https://attacker.example.test/relay/auth/oauth/github/start", relay + "/relay/account", "https://user:secret@relay.example.test/relay/auth/oauth/github/start"] {
            XCTAssertFalse(SystemAuthPolicy.allows(URL(string: path)!, service: web, relay: relay))
        }
    }
    func testRedirectTransportStripsCredentialsAndRejectsUnsafeTargets() throws {
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let source = URL(string: "https://relay.example.test")!
        let task = session.dataTask(with: source)
        let response = HTTPURLResponse(url: source, statusCode: 307, httpVersion: nil, headerFields: nil)!
        let transport = ConnectionProbeTransport()
        var redirect = URLRequest(url: URL(string: "https://web.example.test/")!)
        redirect.setValue("fixture-session", forHTTPHeaderField: "Authorization")
        redirect.setValue("fixture-cookie", forHTTPHeaderField: "Cookie")
        transport.urlSession(session, task: task, willPerformHTTPRedirection: response, newRequest: redirect) { clean in
            XCTAssertNotNil(clean)
            XCTAssertNil(clean?.value(forHTTPHeaderField: "Authorization"))
            XCTAssertNil(clean?.value(forHTTPHeaderField: "Cookie"))
            XCTAssertFalse(clean?.httpShouldHandleCookies ?? true)
        }
        for value in ["http://untrusted.example.test/", "https://user:secret@web.example.test/", "file:///tmp/test"] {
            transport.urlSession(session, task: task, willPerformHTTPRedirection: response, newRequest: URLRequest(url: URL(string: value)!)) { XCTAssertNil($0) }
        }
    }

}
