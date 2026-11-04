import ActivityKit
import SwiftUI
import WidgetKit

@main
struct PockymoeWidgets: WidgetBundle {
    var body: some Widget { PockymoeLiveActivity() }
}

struct PockymoeLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PockymoeActivityAttributes.self) { context in
            let presentation = ActivityPresentation(state: context.state)
            ActivityLockScreen(state: context.state)
            .activityBackgroundTint(Color(uiColor: .systemBackground))
            .activitySystemActionForegroundColor(.primary)
            .widgetURL(presentation.url)
        } dynamicIsland: { context in
            let state = context.state
            let presentation = ActivityPresentation(state: state)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    ActivityExpanded(state: state)
                }
            } compactLeading: {
                StatusMark(state: state.status, size: 18)
            } compactTrailing: {
                ActivityTrailing(state: state)
            } minimal: {
                StatusMark(state: state.status)
            }
            .widgetURL(presentation.url)
        }
    }
}
