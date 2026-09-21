import ActivityKit
import Foundation
import React

/**
 * App-side bridge for the Day-recorder Live Activity (Dynamic Island + lock screen).
 *
 * `start` requests an ActivityKit activity with a live count-up timer; `stop` ends it. The widget's
 * Stop button runs `StopRecordingIntent` (in this app process) which posts `.offgridStopRecording`;
 * this module observes that and emits `RecordingLiveActivityAction` to JS so the recorder stops just
 * like the in-app button. No-op below iOS 16.1.
 */
@objc(RecordingLiveActivityModule)
class RecordingLiveActivityModule: RCTEventEmitter {
  private var hasListeners = false

  override init() {
    super.init()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(onStopIntent),
      name: Notification.Name("OffgridStopRecording"),
      object: nil
    )
  }

  @objc private func onStopIntent() {
    guard hasListeners else { return }
    sendEvent(withName: "RecordingLiveActivityAction", body: ["action": "stop"])
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }
  override func supportedEvents() -> [String]! { ["RecordingLiveActivityAction"] }
  @objc override static func requiresMainQueueSetup() -> Bool { false }

  @objc(start:rejecter:)
  func start(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard #available(iOS 16.1, *) else {
      reject("unsupported", "Live Activities require iOS 16.1+", nil)
      return
    }
    Task {
      await endAllActivities()
      do {
        _ = try Activity.request(
          attributes: RecordingActivityAttributes(title: "Day recorder"),
          content: .init(
            state: RecordingActivityAttributes.ContentState(startedAt: Date()),
            staleDate: nil
          ),
          pushType: nil
        )
        resolve(nil)
      } catch {
        reject("live_activity_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(stop:rejecter:)
  func stop(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard #available(iOS 16.1, *) else {
      resolve(nil)
      return
    }
    Task {
      await endAllActivities()
      resolve(nil)
    }
  }

  @available(iOS 16.1, *)
  private func endAllActivities() async {
    for activity in Activity<RecordingActivityAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
}
