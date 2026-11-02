#if DEBUG
import SwiftUI
import WebKit

// Explicit local opt-in; scripts/results never enter a Release binary.
@MainActor
final class DebugHarness {
    private var running = false
    private var watcher: Task<Void, Never>?
    private var runner: Task<Void, Never>?
    func stop() { watcher?.cancel(); runner?.cancel() }
    private var lastInput: Data?
    var cancelAuth: (() -> Void)?
    var inspectPrivacy: (() -> Void)?
    var changeAddress: (() -> Void)?
    var retry: (() -> Void)?
    func record(state: String, path: String) {
        guard ProcessInfo.processInfo.arguments.contains("--debug-harness") else { return }
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        if let data = try? JSONSerialization.data(withJSONObject: ["state": state, "path": path]) {
            try? data.write(to: directory.appendingPathComponent("acceptance-native.json"), options: .atomic)
        }
    }
    func watch(web: WKWebView) {
        guard ProcessInfo.processInfo.arguments.contains("--debug-harness") else { return }
        watcher = Task { [weak self, weak web] in
            while !Task.isCancelled, let self, let web {
                let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                let retryFile = directory.appendingPathComponent("acceptance-retry")
                if FileManager.default.fileExists(atPath: retryFile.path) { try? FileManager.default.removeItem(at: retryFile); self.retry?() }
                let change = directory.appendingPathComponent("acceptance-change-address")
                if FileManager.default.fileExists(atPath: change.path) { try? FileManager.default.removeItem(at: change); self.changeAddress?() }
                let cancel = directory.appendingPathComponent("acceptance-cancel-auth")
                if FileManager.default.fileExists(atPath: cancel.path) { try? FileManager.default.removeItem(at: cancel); self.cancelAuth?() }
                let inspect = directory.appendingPathComponent("acceptance-inspect-privacy")
                if FileManager.default.fileExists(atPath: inspect.path) { try? FileManager.default.removeItem(at: inspect); self.inspectPrivacy?() }
                self.run(web: web)
                try? await Task.sleep(for: .milliseconds(300))
            }
        }
    }
    func run(web: WKWebView) {
        guard !running, web.url?.host != nil, !web.isLoading, ProcessInfo.processInfo.arguments.contains("--debug-harness") else { return }
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let input = directory.appendingPathComponent("acceptance.json")
        guard let data = try? Data(contentsOf: input), data != lastInput, let steps = try? JSONDecoder().decode([Step].self, from: data) else { return }
        lastInput = data
        running = true
        runner = Task {
            var results: [[String: Any]] = []
            for step in steps {
                if Task.isCancelled { break }
                let deadline = Date().addingTimeInterval(step.timeout ?? 30)
                var result: Any = NSNull()
                var failure: String?
                repeat {
                    do {
                        result = try await web.callAsyncJavaScript(step.script, arguments: [:], in: nil, contentWorld: .page) ?? NSNull()
                        failure = nil
                        if step.wait != true || (result as? Bool) == true { break }
                    } catch { failure = error.localizedDescription }
                    try? await Task.sleep(for: .milliseconds(200))
                } while Date() < deadline
                let ok = failure == nil && (step.wait != true || (result as? Bool) == true)
                results.append(["name": step.name, "ok": ok, "result": result, "error": failure ?? ""])
                if let data = try? JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted, .sortedKeys]) {
                    try? data.write(to: directory.appendingPathComponent("acceptance-progress.json"), options: .atomic)
                }
                if !ok { break }
            }
            if let data = try? JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted, .sortedKeys]) {
                try? data.write(to: directory.appendingPathComponent("acceptance-results.json"), options: .atomic)
            }
            if (try? Data(contentsOf: input)) == data { try? FileManager.default.removeItem(at: input) }
            running = false
        }
    }
    private struct Step: Decodable {
        let name: String
        let script: String
        var wait: Bool?
        var timeout: Double?
    }
}
#endif
