import XCTest
@testable import ActivityPolicy

final class ServiceConfigurationTests: XCTestCase {
    func testFreshInstallHasNoAddressAndEmptyInputIsInvalid() throws {
        let suite = "ios-service-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        XCTAssertNil(ServiceConfiguration.stored(in: defaults))
        XCTAssertNil(ServiceConfiguration(service: ""))
    }
    func testEmbeddedDefaultsRepairOnlyMatchingDirectWebPair() throws {
        let suite = "ios-defaults-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let embedded = try XCTUnwrap(ServiceConfiguration.embedded(in: [
            "PockymoeDefaultWebOrigin": "https://web.example.test",
            "PockymoeDefaultRelayOrigin": "https://relay.example.test"
        ]))
        XCTAssertEqual(ServiceConfiguration.initial(in: defaults, embedded: embedded), embedded)
        ServiceConfiguration(service: embedded.webOrigin)!.save(in: defaults)
        XCTAssertEqual(ServiceConfiguration.initial(in: defaults, embedded: embedded), embedded)
        let explicit = ServiceConfiguration(service: embedded.webOrigin, relay: "https://other.example.test")!
        explicit.save(in: defaults)
        XCTAssertEqual(ServiceConfiguration.initial(in: defaults, embedded: embedded), explicit)
        let different = ServiceConfiguration(service: "https://different.example.test")!
        different.save(in: defaults)
        XCTAssertEqual(ServiceConfiguration.initial(in: defaults, embedded: embedded), different)
        defaults.removeObject(forKey: "relay_url"); defaults.removeObject(forKey: "shell.relayOrigin")
        XCTAssertNil(ServiceConfiguration.initial(in: defaults, embedded: nil))
        XCTAssertNil(ServiceConfiguration.embedded(in: ["PockymoeDefaultWebOrigin": embedded.webOrigin]))
        XCTAssertNil(ServiceConfiguration.embedded(in: ["PockymoeDefaultWebOrigin": "https://user:secret@example.test", "PockymoeDefaultRelayOrigin": embedded.relayOrigin]))
    }
    func testStoredLegacyAddressIsPreservedAndSeparateRelayPersists() throws {
        let suite = "ios-service-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("https://installed.example.com", forKey: "relay_url")
        let legacy = try XCTUnwrap(ServiceConfiguration.stored(in: defaults))
        XCTAssertEqual(legacy.webOrigin, "https://installed.example.com")
        XCTAssertEqual(legacy.relayOrigin, legacy.webOrigin)
        let separate = try XCTUnwrap(ServiceConfiguration(service: "https://web.example.com", relay: "https://relay.example.com"))
        separate.save(in: defaults)
        XCTAssertEqual(ServiceConfiguration.stored(in: defaults), separate)
    }
    func testRejectsNonOriginsAndNormalizesOptionalRelay() throws {
        XCTAssertNil(ServiceConfiguration(service: "https://user:password@example.com"))
        XCTAssertNil(ServiceConfiguration(service: "https://example.com/path"))
        XCTAssertNil(ServiceConfiguration(service: "https://example.com?x=1"))
        XCTAssertNil(ServiceConfiguration(service: "https://example.com", relay: "invalid"))
        let config = try XCTUnwrap(ServiceConfiguration(service: " https://WEB.example.com:443/ ", relay: "  "))
        XCTAssertEqual(config.webOrigin, "https://web.example.com")
        XCTAssertEqual(config.relayOrigin, config.webOrigin)
    }
}
