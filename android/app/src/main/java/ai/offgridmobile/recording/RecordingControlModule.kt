package ai.offgridmobile.recording

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Android half of the recording-notification contract (src/services/ambient/recordingNotification.ts).
 *
 * Thin: it starts/stops the foreground RecordingService that owns the ongoing notification. When the
 * user taps a notification action the service posts a `RecordingNotificationAction` device event, which
 * the recorder listens for on the JS side.
 */
class RecordingControlModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "RecordingControlModule"

    @ReactMethod
    fun start(elapsedMs: Double, promise: Promise) {
        try {
            RecordingService.start(reactContext, elapsedMs.toLong())
            promise.resolve(null)
        } catch (e: RuntimeException) {
            // A denied foreground-service start must not crash: recording still runs in-app.
            promise.reject("recording_notification_failed", e)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        RecordingService.stop(reactContext)
        promise.resolve(null)
    }

    // Present so a JS NativeEventEmitter doesn't warn; JS listens via DeviceEventEmitter directly.
    @ReactMethod fun addListener(eventName: String) = Unit

    @ReactMethod fun removeListeners(count: Double) = Unit

    override fun invalidate() {
        // A reload must not leave an orphan notification promising a recording the engine has dropped.
        RecordingService.stop(reactContext)
        super.invalidate()
    }
}
