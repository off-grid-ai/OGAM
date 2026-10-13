package ai.offgridmobile.video

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import java.util.concurrent.CompletableFuture

class VideoGenerationService : Service() {
    companion object {
        const val CHANNEL = "offgrid-video-generation"
        var admission = CompletableFuture<Unit>()
        var cancel: (() -> Unit)? = null
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "cancel") { cancel?.invoke(); return START_NOT_STICKY }
        try {
            val manager = getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, "Media generation", NotificationManager.IMPORTANCE_LOW))
            val stop = PendingIntent.getService(this, 0, Intent(this, VideoGenerationService::class.java).setAction("cancel"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
            val notification = builder.setContentTitle(if (intent?.getStringExtra("modality") == "image") "Generating image" else "Generating video").setContentText("Off Grid is using this device.")
                .setSmallIcon(android.R.drawable.ic_menu_slideshow).setOngoing(true)
                .addAction(Notification.Action.Builder(null, "Stop", stop).build()).build()
            if (Build.VERSION.SDK_INT >= 35) startForeground(7413, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING)
            else if (Build.VERSION.SDK_INT >= 34) startForeground(7413, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(7413, notification)
            admission.complete(Unit)
        } catch (error: Throwable) { admission.completeExceptionally(error); cancel?.invoke(); stopSelf() }
        return START_NOT_STICKY
    }
    override fun onTimeout(startId: Int, fgsType: Int) { cancel?.invoke(); stopSelf() }
    override fun onDestroy() { cancel?.invoke(); super.onDestroy() }
}
