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
