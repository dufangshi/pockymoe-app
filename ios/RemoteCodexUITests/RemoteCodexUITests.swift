import XCTest

final class RemoteCodexUITests: XCTestCase {
    func testLoginNavigateThreadAndOpenCompletedNotification() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        func value(_ key: String) throws -> String {
            try XCTUnwrap(env[key], "Missing simulator test configuration: \(key)")
        }
        let relay = try value("E2E_RELAY_URL")
        let token = try value("E2E_TOKEN")
        let device = try value("E2E_DEVICE_ID")
        let workspace = try value("E2E_WORKSPACE_ID")
        let api = try value("E2E_DEVICE_API")
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting"]
        app.launchEnvironment = ["E2E_RELAY_URL": relay, "E2E_TOKEN": token]
        app.launch()
        let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = system.alerts.buttons["Allow"].firstMatch
        if allow.waitForExistence(timeout: 10) { allow.tap() }
        let web = app.webViews["productWebView"]
        XCTAssertTrue(web.waitForExistence(timeout: 20))
        XCTAssertTrue(app.links["Open devices"].waitForExistence(timeout: 20), app.debugDescription)

        func post(_ path: String, _ body: [String: Any]) throws -> [String: Any] {
            var request = URLRequest(url: try XCTUnwrap(URL(string: api + path)))
            request.httpMethod = "POST"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let done = expectation(description: path)
            var result: [String: Any] = [:]
            URLSession.shared.dataTask(with: request) { data, response, error in
                XCTAssertNil(error)
                XCTAssertTrue((200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 0))
                if let data { result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:] }
                done.fulfill()
            }.resume()
            wait(for: [done], timeout: 20)
            return result
        }
        // The foreground durable-feed watcher must deliver a real system banner
        // for another completed thread; no test-only in-app banner substitutes.
        let created = try post("/threads/start", ["workspaceId": workspace, "title": "iOS notification regression", "provider": "acp", "agentId": "codex", "model": "ios-e2e-stream", "approvalMode": "yolo"])
        let thread = try XCTUnwrap(created["id"] as? String ?? (created["thread"] as? [String: Any])?["id"] as? String)
        _ = try post("/threads/\(thread)/prompt", ["prompt": "Reply with hello."])
        let banner = system.staticTexts["Agent run finished. Tap to open this thread."].firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 30), "Real system completion banner must arrive")
        banner.tap()
        let route = NSPredicate(format: "value == %@", "/devices/\(device)/threads/\(thread)")
        expectation(for: route, evaluatedWith: web)
        waitForExpectations(timeout: 30)
        let prompt = app.textViews["Prompt"]
        XCTAssertTrue(prompt.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertEqual(app.buttons.matching(identifier: "Thread tools").count, 1, "No duplicate native toolbar")
        XCTAssertFalse(app.buttons["Download transcript"].exists, "Tools default collapsed")
        app.buttons["Thread tools"].tap()
        XCTAssertTrue(app.buttons["Download transcript"].waitForExistence(timeout: 5))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Shared thread UI opened from system notification"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    /// The composer rises once above the soft keyboard and the keyboard stays.
    /// Runs against scripts/ios-keyboard-mock.py (the tour's sample thread).
    func testComposerStaysAboveKeyboard() throws {
        continueAfterFailure = true
        let relay = try XCTUnwrap(ProcessInfo.processInfo.environment["E2E_RELAY_URL"], "Missing E2E_RELAY_URL")
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting"]
        app.launchEnvironment = ["E2E_RELAY_URL": relay, "E2E_TOKEN": "keyboard-check"]
        app.launch()
        let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = system.alerts.buttons["Allow"].firstMatch
        if allow.waitForExistence(timeout: 5) { allow.tap() }
        let prompt = app.textViews["Prompt"]
        XCTAssertTrue(prompt.waitForExistence(timeout: 40), app.debugDescription)
        // A first-visit card can sit over the page; it is not part of this check.
        let later = app.buttons["Later"].firstMatch
        if later.waitForExistence(timeout: 3) { later.tap() }
        func capture(_ name: String) {
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            add(shot)
        }
        capture("before tapping the composer")
        let idle = app.images.matching(NSPredicate(format: "label BEGINSWITH 'KBPROBE'")).firstMatch
        print("KEYBOARD-PROBE-BEFORE \(idle.exists ? idle.label : "missing")")
        let before = prompt.frame
        prompt.tap()
        let keyboard = app.keyboards.firstMatch
        let shown = keyboard.waitForExistence(timeout: 8)
        Thread.sleep(forTimeInterval: 0.6)
        capture("keyboard just opened")
        Thread.sleep(forTimeInterval: 2.5)
        capture("three seconds later")
        let stays = keyboard.exists && keyboard.frame.height > 0
        let gap = keyboard.frame.minY - prompt.frame.maxY
        let probe = app.images.matching(NSPredicate(format: "label BEGINSWITH 'KBPROBE'")).firstMatch
        print("KEYBOARD-PROBE \(probe.exists ? probe.label : "missing")")
        print("KEYBOARD-CHECK shown=\(shown) stays=\(stays) keyboardTop=\(keyboard.frame.minY) keyboardHeight=\(keyboard.frame.height) promptBefore=\(before) promptAfter=\(prompt.frame) gap=\(gap) window=\(app.windows.firstMatch.frame)")
        XCTAssertTrue(shown, "The soft keyboard opens")
        XCTAssertTrue(stays, "The soft keyboard stays open")
        XCTAssertGreaterThanOrEqual(gap, 0, "The composer is not under the keyboard")
        XCTAssertLessThan(gap, 90, "The composer sits just above the keyboard, not far above it")
    }
}
