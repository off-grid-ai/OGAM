package ai.offgridmobile.atlasdevice

import android.content.Intent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/** Hands text shared into Atlas (or selected and sent with "Ask Atlas") to the app: once at start, and live while it runs. */
object ShareBridge {
    @Volatile var listener: ((String) -> Unit)? = null

    /** The shared text in an intent, or null. The text is taken out of the intent so a screen turn does not offer it again. */
    fun read(intent: Intent?): String? {
        intent ?: return null
        val text = ShareText.from(
            intent.action, intent.type,
            intent.getCharSequenceExtra(Intent.EXTRA_TEXT),
            intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT),
        ) ?: return null
        intent.removeExtra(Intent.EXTRA_TEXT)
        intent.removeExtra(Intent.EXTRA_PROCESS_TEXT)
        intent.action = Intent.ACTION_MAIN
        return text
    }

    /** A new intent arrived while Atlas runs. If the app side is not listening yet, the intent is left for getInitialShare. */
    fun deliver(intent: Intent?) {
        val send = listener ?: return
        read(intent)?.let(send)
    }
}

class AtlasShareModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName() = "AtlasShare"

    override fun initialize() {
        super.initialize()
        ShareBridge.listener = { text ->
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("AtlasShareText", text)
        }
    }

    override fun invalidate() {
        ShareBridge.listener = null
        super.invalidate()
    }

    @ReactMethod
    fun getInitialShare(promise: Promise) {
        promise.resolve(ShareBridge.read(ctx.currentActivity?.intent))
    }

    // Required by NativeEventEmitter.
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Double) {}
}
