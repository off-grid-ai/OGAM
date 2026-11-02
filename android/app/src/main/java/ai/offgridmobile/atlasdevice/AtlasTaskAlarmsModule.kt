package ai.offgridmobile.atlasdevice

import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** Lets the app hand over the notifications to show for scheduled tasks. */
class AtlasTaskAlarmsModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName() = "AtlasTaskAlarms"

    /** Replaces all alarms with the JSON list [{id, at, title, body}]. */
    @ReactMethod
    fun setAlarms(json: String, promise: Promise) {
        try {
            TaskAlarms.apply(ctx, TaskAlarms.parse(json))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("TASK_ALARMS", e)
        }
    }

    @ReactMethod
    fun notificationsEnabled(promise: Promise) {
        promise.resolve(NotificationManagerCompat.from(ctx).areNotificationsEnabled())
    }
}
