import XCTest
@testable import ActivityPolicy

final class SessionCleanupTests: XCTestCase {
    func testSignoutClearsMetadataWithoutAnotherSync() throws {
        let suite = "ios-clear-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let item = ActivityItem(key: "d:t", deviceId: "d", deviceName: "private device", workspaceLabel: "private workspace", threadId: "t", title: "private title", state: "running", since: "2026-01-01T00:00:00Z")
        ActivityMetadataCache.save(.init(accountId: "a", items: [item]), in: defaults)
        XCTAssertEqual(ActivityMetadataCache.load(in: defaults).count, 1)
        ActivityMetadataCache.clear(in: defaults)
        XCTAssertTrue(ActivityMetadataCache.load(in: defaults).isEmpty)
        XCTAssertNil(defaults.object(forKey: "activityAccount"))
        XCTAssertNil(defaults.object(forKey: "activityMetadata"))
    }
    func testUpgradeTakesLegacyTokenOnceAndKeepsItsOriginalRelay() throws {
        let suite = "ios-token-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("fixture-session", forKey: "relay_token")
        defaults.set("https://old-relay.example.test", forKey: "relay_url")
        let value = try XCTUnwrap(LegacySessionCleanup.take(from: defaults))
        XCTAssertEqual(value.origin.absoluteString, "https://old-relay.example.test")
        XCTAssertNil(defaults.object(forKey: "relay_token"))
        XCTAssertNil(LegacySessionCleanup.take(from: defaults))
    }
    func testLegacyTokenIsNeverSentToSeparateWebOrigin() throws {
        let suite = "ios-token-pair-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("fixture-session", forKey: "relay_token")
        defaults.set("https://web.example.test", forKey: "relay_url")
        defaults.set("https://relay.example.test", forKey: "shell.relayOrigin")
        let value = try XCTUnwrap(LegacySessionCleanup.take(from: defaults))
        XCTAssertEqual(value.origin.absoluteString, "https://relay.example.test")
        XCTAssertNil(defaults.object(forKey: "relay_token"))
    }

    func testRevocationCannotFollowRedirectToWeb() {
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let source = URL(string: "https://relay.example.test/relay/auth/logout")!
        let task = session.dataTask(with: source)
        let response = HTTPURLResponse(url: source, statusCode: 307, httpVersion: nil, headerFields: nil)!
        LegacySessionRevoker().urlSession(session, task: task, willPerformHTTPRedirection: response, newRequest: URLRequest(url: URL(string: "https://web.example.test/")!)) { XCTAssertNil($0) }
    }

}
