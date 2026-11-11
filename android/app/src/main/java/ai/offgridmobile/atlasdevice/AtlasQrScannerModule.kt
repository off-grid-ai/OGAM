package ai.offgridmobile.atlasdevice

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** Scans a QR code with the in-app camera screen. Resolves the code, or null when cancelled. */
class AtlasQrScannerModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx), ActivityEventListener {
    private var pending: Promise? = null

    init { ctx.addActivityEventListener(this) }

    override fun getName() = "AtlasQrScanner"

    @ReactMethod
    fun scan(prefix: String, hint: String, promise: Promise) {
        val activity = ctx.currentActivity ?: return promise.reject("QR_SCAN", "Atlas is not in the foreground")
        pending?.resolve(null)
        pending = promise
        activity.startActivityForResult(
            Intent(activity, AtlasQrScanActivity::class.java)
                .putExtra(AtlasQrScanActivity.EXTRA_PREFIX, prefix)
                .putExtra(AtlasQrScanActivity.EXTRA_HINT, hint),
            REQUEST)
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST) return
        val promise = pending ?: return
        pending = null
        promise.resolve(if (resultCode == Activity.RESULT_OK) data?.getStringExtra(AtlasQrScanActivity.EXTRA_VALUE) else null)
    }

    override fun onNewIntent(intent: Intent) {}

    companion object { private const val REQUEST = 47021 }
}
