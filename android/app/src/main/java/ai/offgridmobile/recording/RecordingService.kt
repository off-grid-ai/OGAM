package ai.offgridmobile.recording

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Foreground service that keeps the ambient recorder alive in the background AND shows an ongoing
 * notification with Stop / Pause / Resume controls, so a recording can be driven from the shade
 * without opening the app.
 *
 * The mic capture itself lives in the RN process (react-native-audio-api); this service supplies the
 * `microphone` foreground-service umbrella that Android 14+ requires for background capture, plus the
 * notification. Tapping an action posts { action } back to JS (RecordingService.EVENT), which the
 * recorder turns into stop()/pause()/resume(); Stop also tears the service down.
 */
class RecordingService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                elapsedBaseMs = System.currentTimeMillis() - intent.getLongExtra(EXTRA_ELAPSED_MS, 0L)
                startForegroundCompat()
            }
            ACTION_STOP -> {
                emit("stop")
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            else -> stopSelf(startId)
        }
        return START_NOT_STICKY
    }

    private fun startForegroundCompat() {
        val notification = build(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, FOREGROUND_SERVICE_TYPE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun build(context: Context): Notification =
        NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Recording your day")
            .setSmallIcon(android.R.drawable.presence_audio_online)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(launchAppIntent(context))
            // A native chronometer counts up from the base with no per-second re-post from JS.
            .setUsesChronometer(true)
            .setWhen(elapsedBaseMs)
            .addAction(0, "Stop", servicePendingIntent(context, ACTION_STOP))
            .build()

    private fun emit(action: String) {
        val reactContext =
            (application as? ReactApplication)
                ?.reactNativeHost
                ?.reactInstanceManager
                ?.currentReactContext
                ?: return
        val map = Arguments.createMap().apply { putString("action", action) }
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(EVENT, map)
    }

    companion object {
        const val CHANNEL_ID = "offgrid-recording"
        const val NOTIFICATION_ID = 4712
        const val EVENT = "RecordingNotificationAction"
        const val ACTION_START = "ai.offgridmobile.recording.START"
        const val ACTION_STOP = "ai.offgridmobile.recording.STOP"
        const val EXTRA_ELAPSED_MS = "elapsed_ms"
        val FOREGROUND_SERVICE_TYPE =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            } else {
                0
            }

        // Only one recording runs at a time; the chronometer base is the single piece of state.
        private var elapsedBaseMs = 0L

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (manager.getNotificationChannel(CHANNEL_ID) != null) return
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Recording", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shown while the Day recorder is capturing, with controls to pause or stop."
                    setShowBadge(false)
                },
            )
        }

        fun start(context: Context, elapsedMs: Long) {
            ensureChannel(context)
            val intent = Intent(context, RecordingService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_ELAPSED_MS, elapsedMs)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, RecordingService::class.java))
        }

        private fun servicePendingIntent(context: Context, action: String): PendingIntent {
            val intent = Intent(context, RecordingService::class.java).setAction(action)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            return PendingIntent.getService(context, action.hashCode(), intent, flags)
        }

        private fun launchAppIntent(context: Context): PendingIntent? {
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
            return PendingIntent.getActivity(
                context,
                0,
                launch,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
    }
}
