package ai.offgridmobile.atlasdevice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** A reboot clears every alarm; this sets the saved ones again. */
class TaskAlarmBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            try {
                TaskAlarms.rearm(context)
            } catch (_: Exception) {
                // The app sets them again the next time it opens.
            }
        }
    }
}
