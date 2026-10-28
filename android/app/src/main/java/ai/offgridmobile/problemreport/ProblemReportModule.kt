package ai.offgridmobile.problemreport

import android.content.ActivityNotFoundException
import android.content.Intent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Report a problem: opens a mail app with the support address in To, the subject and the log
 * text already filled in. The share sheet cannot set a recipient, so JS uses this first and keeps
 * the share sheet only as the fallback. Resolves false when no app can take the mail.
 */
class ProblemReportModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ProblemReportModule"

    @ReactMethod
    fun composeEmail(to: String, subject: String, body: String, promise: Promise) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "message/rfc822"
            putExtra(Intent.EXTRA_EMAIL, arrayOf(to))
            putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, body)
        }
        val chooser = Intent.createChooser(send, subject)
        val activity = reactApplicationContext.currentActivity
        try {
            if (activity != null) {
                activity.startActivity(chooser)
            } else {
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactApplicationContext.startActivity(chooser)
            }
            promise.resolve(true)
        } catch (e: ActivityNotFoundException) {
            promise.resolve(false)
        } catch (e: Exception) {
            promise.reject("PROBLEM_REPORT_ERROR", e)
        }
    }
}
