package ai.offgridmobile.atlasaudio

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Native module that lets JS start, stop and monitor the background audio service.
 *
 * JS events emitted:
 *   AtlasAudioProgress  — { index: number }   when a new file starts
 *   AtlasAudioFinished  — {}                   when the queue completes
 *   AtlasAudioError     — { message: string }  on failure
 */
class AtlasAudioModule(private val reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "AtlasAudio"

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                AtlasAudioService.ACTION_PROGRESS -> {
                    val p = Arguments.createMap().apply {
                        putInt("index", intent.getIntExtra(AtlasAudioService.EXTRA_INDEX, 0))
                    }
                    emit("AtlasAudioProgress", p)
                }
                AtlasAudioService.ACTION_FINISHED -> emit("AtlasAudioFinished", Arguments.createMap())
                AtlasAudioService.ACTION_ERROR -> {
                    val p = Arguments.createMap().apply {
                        putString("message", intent.getStringExtra(AtlasAudioService.EXTRA_MESSAGE) ?: "")
                    }
                    emit("AtlasAudioError", p)
                }
            }
        }
    }

    private var receiverRegistered = false

    private fun ensureReceiverRegistered() {
        if (receiverRegistered) return
        val filter = IntentFilter().apply {
            addAction(AtlasAudioService.ACTION_PROGRESS)
            addAction(AtlasAudioService.ACTION_FINISHED)
            addAction(AtlasAudioService.ACTION_ERROR)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactContext.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            reactContext.registerReceiver(receiver, filter)
        }
        receiverRegistered = true
    }

    private fun emit(event: String, params: com.facebook.react.bridge.WritableMap) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, params)
    }

    @ReactMethod
    fun play(files: ReadableArray, startIndex: Int, speed: Double, volume: Double) {
        ensureReceiverRegistered()
        val list = ArrayList<String>()
        for (i in 0 until files.size()) files.getString(i)?.let { list.add(it) }
        val intent = Intent(reactContext, AtlasAudioService::class.java).apply {
            action = AtlasAudioService.ACTION_PLAY
            putStringArrayListExtra(AtlasAudioService.EXTRA_FILES, list)
            putExtra(AtlasAudioService.EXTRA_START, startIndex)
            putExtra(AtlasAudioService.EXTRA_SPEED, speed.toFloat())
            putExtra(AtlasAudioService.EXTRA_VOLUME, volume.toFloat())
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.startForegroundService(intent)
        } else {
            reactContext.startService(intent)
        }
    }

    @ReactMethod
    fun stop() {
        val intent = Intent(reactContext, AtlasAudioService::class.java).apply {
            action = AtlasAudioService.ACTION_STOP
        }
        reactContext.startService(intent)
    }

    @ReactMethod
    fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) { /* required by RN */ }

    @ReactMethod
    fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Int) { /* required by RN */ }

    override fun onCatalystInstanceDestroy() {
        if (receiverRegistered) {
            try { reactContext.unregisterReceiver(receiver) } catch (_: Exception) {}
            receiverRegistered = false
        }
        super.onCatalystInstanceDestroy()
    }
}
