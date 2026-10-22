package ai.offgridmobile.clipboard

import android.content.ClipData
import android.content.ClipboardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule

internal class SyncClipboardObserver(
    private val context: Context,
    private val clipboardManager: ClipboardManager,
    private val onText: (String, Double) -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private var enabled = false
    private var lastPublishedText: String? = null
    private var lastPublishedAt = Long.MIN_VALUE
    private val listener = ClipboardManager.OnPrimaryClipChangedListener {
        if (!enabled) return@OnPrimaryClipChangedListener
        val at = now()
        // Android 10+ returns null when another app owns focus. External selections enter through
        // ProcessTextActivity instead; never guess at text Android did not provide.
        val clip = clipboardManager.primaryClip ?: return@OnPrimaryClipChangedListener
        if (clip.description.label?.toString() == SYNC_CLIP_LABEL) {
            return@OnPrimaryClipChangedListener
        }
        val item = clip.getItemAt(0)
        val text = item.coerceToText(context)?.toString() ?: return@OnPrimaryClipChangedListener
        publishOnce(text, at)
    }

    private fun publishOnce(text: String, at: Long) {
        if (!enabled) return
        val duplicate = text == lastPublishedText && at - lastPublishedAt in 0..COPY_COALESCE_MS
        if (duplicate) return
        lastPublishedText = text
        lastPublishedAt = at
        onText(text, at.toDouble())
    }

    fun setEnabled(next: Boolean) {
        if (enabled == next) return
        enabled = next
        if (next) {
            clipboardManager.addPrimaryClipChangedListener(listener)
        } else {
            clipboardManager.removePrimaryClipChangedListener(listener)
            lastPublishedText = null
            lastPublishedAt = Long.MIN_VALUE
        }
    }

    fun writeText(text: String) {
        clipboardManager.setPrimaryClip(ClipData.newPlainText(SYNC_CLIP_LABEL, text))
    }

    private companion object {
        const val SYNC_CLIP_LABEL = "Off Grid Sync"
        const val COPY_COALESCE_MS = 1_000L
    }
}

class SyncClipboardModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    private val handoffStore = ProcessTextHandoffStore(reactContext)
    // React Native builds modules on a background thread with no Looper. Before API 28 the
    // ClipboardManager constructor creates a Handler, so resolving it there crashes the app on
    // every start. Every observer use runs on the main thread, so the manager is created there.
    private val observerDelegate = lazy {
        SyncClipboardObserver(
            reactContext,
            reactContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager,
            ::emitText,
        )
    }
    private val observer by observerDelegate

    /** Set before cleanup is queued, so main-thread work queued earlier cannot re-enable the observer. */
    @Volatile private var invalidated = false
    private val pendingReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == ProcessTextActivity.ACTION_HANDOFF_AVAILABLE) {
                emitPendingProcessText()
            }
        }
    }

    init {
        val filter = IntentFilter(ProcessTextActivity.ACTION_HANDOFF_AVAILABLE)
        ContextCompat.registerReceiver(
            reactContext,
            pendingReceiver,
            filter,
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
    }

    override fun getName(): String = "SyncClipboardModule"

    override fun invalidate() {
        invalidated = true
        // Checked on the main thread: an enable queued before this may create the observer first.
        UiThreadUtil.runOnUiThread {
            if (observerDelegate.isInitialized()) observer.setEnabled(false)
        }
        runCatching { reactContext.unregisterReceiver(pendingReceiver) }
        super.invalidate()
    }

    @ReactMethod
    fun setEnabled(enabled: Boolean) {
        UiThreadUtil.runOnUiThread {
            // After invalidation nothing may register a listener this module will never remove.
            if (enabled && invalidated) return@runOnUiThread
            observer.setEnabled(enabled)
        }
    }

    @ReactMethod
    fun writeText(text: String) {
        UiThreadUtil.runOnUiThread { observer.writeText(text) }
    }

    @ReactMethod
    fun readPendingProcessText(promise: Promise) {
        val result = Arguments.createArray()
        handoffStore.pending().forEach { item ->
            result.pushMap(
                Arguments.createMap().apply {
                    putString("id", item.id)
                    putString("text", item.text)
                    putDouble("ts", item.timestamp.toDouble())
                },
            )
        }
        promise.resolve(result)
    }

    @ReactMethod
    fun acknowledgePendingProcessText(ids: ReadableArray, promise: Promise) {
        val acknowledged = buildSet {
            for (index in 0 until ids.size()) {
                ids.getString(index)?.let(::add)
            }
        }
        handoffStore.acknowledge(acknowledged)
        promise.resolve(null)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required by React Native's NativeEventEmitter contract.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Observation is controlled by the persisted Sync preference, not JS listener count.
    }

    private fun emitText(text: String, timestamp: Double) {
        val payload = Arguments.createMap().apply {
            putString("text", text)
            putDouble("ts", timestamp)
        }
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("SyncClipboardChanged", payload)
    }

    private fun emitPendingProcessText() {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("SyncProcessTextAvailable", null)
    }
}
