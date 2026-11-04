#if DEBUG
import SwiftUI

@MainActor
enum DebugIslandRenderer {
    static func renderAll() {
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("island-renders")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        ActivityMetadataCache.save(.init(accountId: "screenshots", items: (0..<5).map { index in
            .init(key: "fixture:\(index)", deviceId: "fixture", deviceName: "Mac", workspaceLabel: "Pockymoe", threadId: "\(index)", title: "修复登录与连接状态 \(index + 1)", state: "running", since: ISO8601DateFormatter().string(from: .now))
        }))
        for mode in ["light", "dark"] {
            for name in ["running", "waiting", "failed", "interrupted", "overflow", "completed"] {
                let state = fixture(name)
                for layout in ["compact", "minimal", "expanded", "lock-screen"] {
                    let view = RenderedActivity(state: state, layout: layout)
                        .environment(\.colorScheme, mode == "dark" ? .dark : .light)
                    let renderer = ImageRenderer(content: view)
                    renderer.scale = 3
                    if let data = renderer.uiImage?.pngData() {
                        try? data.write(to: directory.appendingPathComponent("\(mode)-\(name)-\(layout).png"))
                    }
                }
            }
        }
    }
    static func fixture(_ name: String) -> ActivityContentState {
        let states = name == "failed" ? ["failed", "running"] : name == "overflow" ? ["needsInput", "failed", "running", "running", "running"] : [name == "waiting" ? "needsInput" : name]
        let now = Date()
        let rows = states.prefix(3).enumerated().map { ActivityContentState.Row(key: "fixture:\($0.offset)", state: $0.element, startedAt: now.addingTimeInterval(-134)) }
        return .init(rows: rows, totalCount: states.count, waitingCount: states.filter { $0 == "needsInput" }.count, failedCount: states.filter { $0 == "failed" }.count, runningCount: states.filter { $0 == "running" }.count, completedCount: 1, endedAt: name == "completed" ? now : nil, earliestStart: now.addingTimeInterval(-134))
    }
}

private struct RenderedActivity: View {
    let state: ActivityContentState
    let layout: String
    var body: some View {
        Group {
            if layout == "compact" {
                HStack { StatusMark(state: state.status, size: 18); Spacer().frame(width: 100); ActivityTrailing(state: state) }.padding(12).frame(width: 230, height: 44)
            } else if layout == "minimal" {
                StatusMark(state: state.status).frame(width: 44, height: 44)
            } else if layout == "expanded" {
                ActivityExpanded(state: state).padding(16).frame(width: 370)
            } else {
                ActivityLockScreen(state: state).frame(width: 370)
            }
        }
        .foregroundStyle(layout == "lock-screen" ? Color.primary : Color.white)
        .background(layout == "lock-screen" ? Color(uiColor: .systemBackground) : Color.black)
        .clipShape(RoundedRectangle(cornerRadius: layout == "lock-screen" ? 24 : 22))
    }
}
#endif
