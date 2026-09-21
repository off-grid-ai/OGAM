import ActivityKit
import SwiftUI
import WidgetKit

/**
 * The Day-recorder Live Activity: lock-screen banner + Dynamic Island presentations.
 *
 * The timer counts up on its own from `startedAt` via `Text(_:style:.timer)` — no per-second push
 * from the app. The Stop control is an App Intent so it works straight from the Island/lock screen
 * without opening the app.
 */
struct RecordLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
      // Lock screen / banner
      HStack(spacing: 12) {
        Image(systemName: "waveform.circle.fill")
          .font(.title2)
          .foregroundColor(.red)
        VStack(alignment: .leading, spacing: 2) {
          Text(context.attributes.title)
            .font(.caption)
            .foregroundColor(.secondary)
          Text(context.state.startedAt, style: .timer)
            .font(.headline)
            .monospacedDigit()
        }
        Spacer()
        stopButton(compact: false)
      }
      .padding()
      .activityBackgroundTint(Color.black.opacity(0.55))
      .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label {
            Text(context.attributes.title).font(.caption)
          } icon: {
            Image(systemName: "waveform.circle.fill").foregroundColor(.red)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(context.state.startedAt, style: .timer)
            .monospacedDigit()
            .frame(maxWidth: 64)
            .foregroundColor(.red)
        }
        DynamicIslandExpandedRegion(.bottom) {
          stopButton(compact: false)
        }
      } compactLeading: {
        Image(systemName: "waveform.circle.fill").foregroundColor(.red)
      } compactTrailing: {
        Text(context.state.startedAt, style: .timer)
          .monospacedDigit()
          .frame(maxWidth: 44)
          .foregroundColor(.red)
      } minimal: {
        Image(systemName: "waveform.circle.fill").foregroundColor(.red)
      }
    }
  }

  @ViewBuilder
  private func stopButton(compact: Bool) -> some View {
    if #available(iOS 17.0, *) {
      Button(intent: StopRecordingIntent()) {
        if compact {
          Label("Stop", systemImage: "stop.fill").labelStyle(.iconOnly)
        } else {
          Label("Stop", systemImage: "stop.fill").labelStyle(.titleAndIcon)
        }
      }
      .tint(.red)
      .buttonStyle(.borderedProminent)
    } else {
      EmptyView()
    }
  }
}
