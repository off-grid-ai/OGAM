package ai.offgridmobile.mediashare

import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Share a file the app made (a clip, an image) through the system share sheet. The file stays in the
 * app's own storage; other apps get a one-time read grant through the FileProvider. Only files inside
 * the app's files directory can be shared.
 */
class MediaShareModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "MediaShareModule"

    @ReactMethod
    fun shareFile(path: String, mime: String, promise: Promise) {
        val context = reactApplicationContext
        val file = File(path).canonicalFile
        val root = context.filesDir.canonicalFile
        if (!file.path.startsWith(root.path + File.separator) || !file.isFile) {
            promise.reject("MEDIA_SHARE_PATH", "This file cannot be shared.")
            return
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.mediashare", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(send, null).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            val activity = context.currentActivity
            if (activity != null) {
                activity.startActivity(chooser)
            } else {
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(chooser)
            }
            promise.resolve(true)
        } catch (e: ActivityNotFoundException) {
            promise.resolve(false)
        } catch (e: Exception) {
            promise.reject("MEDIA_SHARE_ERROR", e)
        }
    }
}
