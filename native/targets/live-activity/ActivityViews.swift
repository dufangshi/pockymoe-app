// The Live Activity's views, ported from the iOS shell (feat/mobile-ios ios/Shared/ActivityViews.swift):
// lock screen rows, the Dynamic Island, status marks and timers. Words follow the app's language
// (shared defaults), titles and names come from the app's metadata cache, never from the push.
import SwiftUI

private func words(_ zh: String, _ en: String) -> String {
    ActivityMetadataCache.language() == "zh" ? zh : en
}

struct StatusMark: View {
    let state: String
    var size: CGFloat = 16
    var body: some View {
        // ActivityKit forbids looping custom animation: use the static Web ring
        // vector and the system timer to communicate running (mobile design §6).
        Image(state == "needsInput" ? "waiting" : state == "interrupted" ? "interrupted" : state == "failed" ? "failed" : state == "running" ? "running" : "completed")
            .renderingMode(.template).resizable().frame(width: size, height: size)
            // Balance the bubble body against its lower tail within the fixed box.
            .offset(y: state == "needsInput" ? size / 32 : 0)
            .foregroundStyle(state == "failed" ? Color(red: 0.85, green: 0.32, blue: 0.31) : Color(red: 0.77, green: 0.55, blue: 0.14))
            .accessibilityLabel(state == "needsInput" ? words("等待你", "Waiting for you") : state == "running" ? words("运行中", "Running") : state == "completed" ? words("已完成", "Finished") : state == "interrupted" ? words("已中断", "Interrupted") : words("失败", "Failed"))
    }
}

struct ElapsedTime: View {
    let start: Date
    var body: some View {
        Text(timerInterval: min(start, .now)...Date.distantFuture, countsDown: false)
            .monospacedDigit().font(.caption).lineLimit(1)
            .minimumScaleFactor(0.8).frame(width: 64, alignment: .trailing)
    }
}

struct ActivityPresentation {
    let state: ActivityContentState
    let metadata = ActivityMetadataCache.load()
    var first: ActivityContentState.Row? { state.rows.first }
    func info(_ key: String) -> ActivityMetadata {
        metadata[key] ?? ActivityMetadata(title: words("线程运行中", "A thread is running"), device: "", workspace: "", path: Self.fallbackPath(key))
    }
    static func fallbackPath(_ key: String) -> String {
        let parts = key.split(separator: ":", maxSplits: 1)
        guard parts.count == 2 else { return "" }
        return ActivityMetadataCache.threadPath(device: String(parts[0]), thread: String(parts[1]))
    }
    /// Opens the leading thread in the app (`<scheme>://thread/<device>/<thread>`).
    var url: URL? { URL(string: "\(ActivityMetadataCache.scheme)://" + (first.map { info($0.key).path } ?? "")) }
}

struct ActivityLockScreen: View {
    let state: ActivityContentState
    var body: some View {
        let presentation = ActivityPresentation(state: state)
        VStack(alignment: .leading, spacing: 8) {
            if state.endedAt != nil {
                ActivityCompletionRow(count: state.completedCount)
            } else {
                ForEach(Array(state.rows.prefix(3)), id: \.key) { row in
                    let info = presentation.info(row.key)
                    HStack(spacing: 8) {
                        StatusMark(state: row.state)
                        Text(info.title).lineLimit(1).truncationMode(.middle)
                        Spacer(minLength: 4)
                        Text(info.device).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        ElapsedTime(start: row.startedAt)
                    }
                }
                if state.totalCount > 3 {
                    Text(words("其余 \(state.totalCount - 3) 个", "\(state.totalCount - 3) more")).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
    }
}

struct ActivityCompletionRow: View {
    let count: Int
    var body: some View {
        HStack(spacing: 8) {
            StatusMark(state: "completed")
            Text(words("\(count) 个线程已完成", count == 1 ? "1 thread finished" : "\(count) threads finished")).lineLimit(1)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ActivityExpanded: View {
    let state: ActivityContentState
    var body: some View {
        let presentation = ActivityPresentation(state: state)
        VStack(alignment: .leading, spacing: 6) {
            if state.endedAt != nil {
                ActivityCompletionRow(count: state.completedCount)
            } else {
                HStack(spacing: 8) {
                    StatusMark(state: state.status)
                    Text(presentation.first.map { presentation.info($0.key).title } ?? words("线程运行中", "A thread is running"))
                        .lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 4)
                    ElapsedTime(start: presentation.first?.startedAt ?? state.earliestStart)
                }
            }
            if let row = presentation.first, state.endedAt == nil {
                let info = presentation.info(row.key)
                Text([info.device, info.workspace].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Text(state.expandedStatusLine(english: ActivityMetadataCache.language() != "zh"))
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ActivityTrailing: View {
    let state: ActivityContentState
    var body: some View {
        if state.waitingCount > 0 { Text("\(state.waitingCount)").monospacedDigit() }
        else if state.runningCount > 0 { ElapsedTime(start: state.earliestStart) }
        else if state.endedAt != nil { Text("\(state.completedCount)").monospacedDigit() }
    }
}
