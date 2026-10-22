package ai.offgridmobile.clipboard

import android.app.Application
import android.content.ClipboardManager
import android.content.Context
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.BridgeReactContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [27], application = Application::class)
class SyncClipboardModuleTest {
    @Test
    fun startsOnAThreadWithoutALooperAndStillWritesTheClipboard() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        // The merged manifest grants this on a device; Robolectric's test manifest does not.
        shadowOf(context as Application)
            .grantPermissions("${context.packageName}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION")
        val reactContext = BridgeReactContext(context)
        var module: SyncClipboardModule? = null
        var failure: Throwable? = null

        // React Native constructs modules on a pool thread that never called Looper.prepare().
        val builder = Thread {
            try {
                module = SyncClipboardModule(reactContext)
            } catch (error: Throwable) {
                failure = error
            }
        }
        builder.start()
        builder.join()

        assertNull("Module construction must not touch the clipboard off the main thread", failure)

        module!!.writeText("received from desktop")
        shadowOf(Looper.getMainLooper()).idle()

        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        assertEquals("received from desktop", clipboard.primaryClip?.getItemAt(0)?.text)
    }
}
