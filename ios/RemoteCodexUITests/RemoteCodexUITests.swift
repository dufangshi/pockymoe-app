import XCTest

final class RemoteCodexUITests: XCTestCase {
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    func testWebLoginAndResume() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting"]
        app.launchEnvironment = ["E2E_RELAY_URL": try XCTUnwrap(env["E2E_RELAY_URL"])]
        app.launch()
        let web = app.webViews["productWebView"]
        XCTAssertTrue(web.waitForExistence(timeout: 30))
        let loginLink = web.links.matching(NSPredicate(format: "label == 'Sign in' OR label == '登录'")).firstMatch
        if loginLink.waitForExistence(timeout: 10) { loginLink.tap() }
        let username = web.textFields.firstMatch
        XCTAssertTrue(username.waitForExistence(timeout: 30), app.debugDescription)
        username.tap(); username.typeText(try XCTUnwrap(env["E2E_USERNAME"]))
        let password = web.secureTextFields.firstMatch
        XCTAssertTrue(password.exists)
        password.tap(); password.typeText(try XCTUnwrap(env["E2E_PASSWORD"]))
        let signIn = web.buttons.matching(NSPredicate(format: "label == 'Sign in' OR label == '登录'")).firstMatch
        XCTAssertTrue(signIn.exists, app.debugDescription)
        signIn.tap()
        let devices = web.staticTexts["e2e-phone"].firstMatch
        XCTAssertTrue(devices.waitForExistence(timeout: 40), app.debugDescription)
        capture(app, "web-login-devices")
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(devices.waitForExistence(timeout: 10))
        capture(app, "resume-preserves-web-page")
    }
    func testOfflineRetry() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting"]
        app.launchEnvironment = ["E2E_RELAY_URL": "http://127.0.0.1:28799"]
        app.launch()
        let retry = app.buttons["retryConnection"]
        XCTAssertTrue(retry.waitForExistence(timeout: 20))
        capture(app, "offline")
        retry.tap()
        XCTAssertTrue(retry.waitForExistence(timeout: 20))
    }
    func testActivityFixtures() throws {
        let env = ProcessInfo.processInfo.environment
        for state in ["running", "needsInput", "failed", "overflow", "completed"] {
            let app = XCUIApplication()
            app.launchArguments = ["--uitesting"]
            app.launchEnvironment = ["E2E_RELAY_URL": try XCTUnwrap(env["E2E_RELAY_URL"]), "E2E_ACTIVITY_STATE": state]
            app.launch()
            XCTAssertTrue(app.webViews["productWebView"].waitForExistence(timeout: 20))
            XCUIDevice.shared.press(.home)
            // The system renders asynchronously after ActivityKit accepts the update.
            let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            XCTAssertTrue(system.wait(for: .runningForeground, timeout: 10))
            let label = state == "needsInput" || state == "overflow" ? "等待你" : state == "running" ? "运行中" : state == "failed" ? "失败" : "已完成"
            XCTAssertTrue(system.descendants(matching: .any).matching(identifier: label).firstMatch.waitForExistence(timeout: 15), "System must render the activity before taking evidence")
            capture(system, "island-compact-\(state)")
            let island = system.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.035))
            island.press(forDuration: 1.5)
            capture(system, "island-expanded-\(state)")
            app.terminate()
        }
    }
}
