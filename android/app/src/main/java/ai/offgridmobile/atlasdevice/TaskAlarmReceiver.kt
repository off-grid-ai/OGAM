package ai.offgridmobile.atlasdevice

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import ai.offgridmobile.MainActivity
import ai.offgridmobile.R

/** Shows the notification for a scheduled task. Tapping it opens atlas://app/schedule. */
class TaskAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(TaskAlarms.EXTRA_ID) ?: return
        val title = intent.getStringExtra(TaskAlarms.EXTRA_TITLE) ?: "Atlas"
        val body = intent.getStringExtra(TaskAlarms.EXTRA_BODY) ?: ""
        try {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26) {
                manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Scheduled tasks", NotificationManager.IMPORTANCE_DEFAULT))
            }
            val open = Intent(Intent.ACTION_VIEW, Uri.parse("atlas://app/schedule"), context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            val tap = PendingIntent.getActivity(context, id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(tap)
                .setAutoCancel(true)
                .build()
            manager.notify(id.hashCode(), notification)
        } catch (_: Exception) {
            // No permission to notify, or the system refused: nothing else to do.
        }
    }

    companion object {
        const val CHANNEL_ID = "atlas_scheduled_tasks"
    }
}
