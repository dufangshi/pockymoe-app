import ActivityKit
import SwiftUI
import WidgetKit

@main
struct PockymoeWidgets: WidgetBundle {
    var body: some Widget { PockymoeLiveActivity() }
}

struct StatusMark: View {
    let state: String
    var body: some View {
        // ActivityKit forbids looping custom animation: use the static Web ring
        // vector and the system timer to communicate running (mobile design §6).
        Image(state == "needsInput" ? "waiting" : state == "interrupted" ? "interrupted" : state == "failed" ? "failed" : state == "running" ? "running" : "completed")
            .renderingMode(.template).resizable().frame(width: 16, height: 16)
            .foregroundStyle(state == "failed" ? Color(red: 0.85, green: 0.32, blue: 0.31) : Color(red: 0.77, green: 0.55, blue: 0.14))
            .accessibilityLabel(state == "needsInput" ? "等待你" : state == "running" ? "运行中" : state == "completed" ? "已完成" : state == "interrupted" ? "已中断" : "失败")
    }
}

struct ElapsedTime: View {
    let start: Date
    var body: some View {
        Text(timerInterval: min(start, .now)...Date.distantFuture, countsDown: false)
            .monospacedDigit().font(.caption).frame(maxWidth: 64, alignment: .trailing)
    }
}

struct ActivityPresentation {
    let state: ActivityContentState
    let metadata = ActivityMetadataCache.load()
    var first: ActivityContentState.Row? { state.rows.first }
    func info(_ key: String) -> ActivityMetadata {
        metadata[key] ?? ActivityMetadata(title: "线程运行中", device: "", workspace: "", path: Self.fallbackPath(key))
    }
    static func fallbackPath(_ key: String) -> String {
        let parts = key.split(separator: ":", maxSplits: 1)
        guard parts.count == 2 else { return "/" }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
        return "/devices/\(String(parts[0]).addingPercentEncoding(withAllowedCharacters: allowed) ?? "")/threads/\(String(parts[1]).addingPercentEncoding(withAllowedCharacters: allowed) ?? "")"
    }
    var url: URL? { URL(string: "remotecodex://" + (first.map { info($0.key).path } ?? "/").dropFirst()) }
}

struct PockymoeLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PockymoeActivityAttributes.self) { context in
            let presentation = ActivityPresentation(state: context.state)
            VStack(alignment: .leading, spacing: 8) {
                if context.state.endedAt != nil {
                    Text("\(context.state.completedCount) 个线程已完成")
                } else {
                    ForEach(Array(context.state.rows.prefix(3)), id: \.key) { row in
                        let info = presentation.info(row.key)
                        HStack(spacing: 8) {
                            StatusMark(state: row.state)
                            Text(info.title).lineLimit(1).truncationMode(.middle)
                            Spacer(minLength: 4)
                            Text(info.device).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            ElapsedTime(start: row.startedAt)
                        }
                    }
                    if context.state.totalCount > 3 { Text("其余 \(context.state.totalCount - 3) 个").font(.caption).foregroundStyle(.secondary) }
                }
            }
            .padding(16)
            .activityBackgroundTint(Color(uiColor: .systemBackground))
            .activitySystemActionForegroundColor(.primary)
            .widgetURL(presentation.url)
        } dynamicIsland: { context in
            let state = context.state
            let presentation = ActivityPresentation(state: state)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            StatusMark(state: state.status)
                            Text(state.endedAt != nil ? "\(state.completedCount) 个线程已完成" : presentation.first.map { presentation.info($0.key).title } ?? "线程运行中")
                                .lineLimit(1).truncationMode(.middle)
                            Spacer(minLength: 4)
                            if state.endedAt == nil { ElapsedTime(start: presentation.first?.startedAt ?? state.earliestStart) }
                        }
                        if let row = presentation.first, state.endedAt == nil {
                            let info = presentation.info(row.key)
                            Text([info.device, info.workspace].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            Text(state.waitingCount > 0 ? "等待你处理" : "还有 \(max(0, state.runningCount - (row.state == "running" ? 1 : 0))) 个线程在运行")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            } compactLeading: {
                StatusMark(state: state.status)
            } compactTrailing: {
                if state.waitingCount > 0 { Text("\(state.waitingCount)").monospacedDigit() }
                else if state.runningCount > 0 { ElapsedTime(start: state.earliestStart) }
                else if state.endedAt != nil { Text("\(state.completedCount)").monospacedDigit() }
            } minimal: {
                StatusMark(state: state.status)
            }
            .widgetURL(presentation.url)
        }
    }
}
