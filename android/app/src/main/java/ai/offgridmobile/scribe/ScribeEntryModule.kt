package ai.offgridmobile.scribe

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/** JS side of "Improve": takes the waiting selection and gives the chosen version back. */
class ScribeEntryModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        ScribeImproveRequests.onOffer = {
            if (reactContext.hasActiveReactInstance()) {
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("ScribeImproveRequested", null)
            }
        }
    }

    override fun getName(): String = "ScribeEntryModule"

    override fun invalidate() {
        ScribeImproveRequests.onOffer = null
        super.invalidate()
    }

    @ReactMethod
    fun takePending(promise: Promise) {
        val request = ScribeImproveRequests.take()
        if (request == null) {
            promise.resolve(null)
            return
        }
        promise.resolve(
            Arguments.createMap().apply {
                putString("id", request.id)
                putString("text", request.text)
                putString("apply", if (request.caller != null) "replace" else "copy")
            },
        )
    }

    /** `text` replaces the selection in the calling app; null leaves it as it was. */
    @ReactMethod
    fun finish(id: String, text: String?, promise: Promise) {
        val delivered = ScribeImproveRequests.finish(id, text)
        // Back to the app the text came from: it is under this app's task.
        if (delivered) reactContext.currentActivity?.moveTaskToBack(true)
        promise.resolve(delivered)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required by React Native's NativeEventEmitter contract.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Requests are held natively until taken; nothing to stop.
    }
}
