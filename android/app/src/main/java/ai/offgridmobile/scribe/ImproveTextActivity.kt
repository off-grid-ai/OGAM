package ai.offgridmobile.scribe

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * "Improve" in Android's text-selection menu (PROCESS_TEXT). Hands the selection to the app and
 * stays open, invisible, in the calling app's task until the app gives back the chosen version:
 * the caller then replaces the selection in place. Read-only text is handed over and this closes.
 */
class ImproveTextActivity : Activity() {
    private var opened = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = intent?.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
        if (intent?.action != Intent.ACTION_PROCESS_TEXT || text.isNullOrBlank()) {
            finish()
            return
        }
        val readOnly = intent.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, false)
        ScribeImproveRequests.offer(text, if (readOnly) null else this)
        packageManager.getLaunchIntentForPackage(packageName)?.let {
            startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        opened = true
        if (readOnly) finish()
    }

    override fun onRestart() {
        super.onRestart()
        // The person came back to the other app without choosing: give nothing back, so its text
        // stays as it was, and never leave an invisible screen over it.
        if (opened) finishWith(null)
    }

    override fun onDestroy() {
        ScribeImproveRequests.release(this)
        super.onDestroy()
    }

    fun finishWith(text: String?) {
        if (isFinishing) return
        if (text == null) {
            setResult(RESULT_CANCELED)
        } else {
            setResult(RESULT_OK, Intent().putExtra(Intent.EXTRA_PROCESS_TEXT, text))
        }
        finish()
    }
}
