package ai.offgridmobile.atlasaudio

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import ai.offgridmobile.MainActivity
import ai.offgridmobile.R

/**
 * Foreground service that plays a queue of WAV files so the daily briefing
 * and other pre-rendered audio continues when the user switches away from the app.
 *
 * JS sends ACTION_PLAY with EXTRA_FILES (ArrayList<String>) and EXTRA_START (Int).
 * The service fires broadcasts back:
 *   ACTION_PROGRESS  — EXTRA_INDEX (Int) when a new file starts
 *   ACTION_FINISHED  — the queue finished naturally
 *   ACTION_ERROR     — EXTRA_MESSAGE (String) on failure
 */
class AtlasAudioService : Service() {

    companion object {
        const val ACTION_PLAY     = "ai.offgridmobile.atlas.AUDIO_PLAY"
        const val ACTION_STOP     = "ai.offgridmobile.atlas.AUDIO_STOP"
        const val ACTION_PROGRESS = "ai.offgridmobile.atlas.AUDIO_PROGRESS"
        const val ACTION_FINISHED = "ai.offgridmobile.atlas.AUDIO_FINISHED"
        const val ACTION_ERROR    = "ai.offgridmobile.atlas.AUDIO_ERROR"
        const val EXTRA_FILES     = "files"
        const val EXTRA_START     = "startIndex"
        const val EXTRA_INDEX     = "index"
        const val EXTRA_MESSAGE   = "message"
        const val EXTRA_SPEED     = "speed"
        const val EXTRA_VOLUME    = "volume"
        private const val CHANNEL_ID       = "atlas_audio"
        private const val NOTIFICATION_ID  = 8043
    }

    private var player: MediaPlayer? = null
    private var files: List<String> = emptyList()
    private var currentIndex = 0
    private var speed = 1f
    private var volume = 1f
    private var audioManager: AudioManager? = null
    private var focusRequest: AudioFocusRequest? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopPlayback(); return START_NOT_STICKY }
            ACTION_PLAY -> {
                val newFiles = intent.getStringArrayListExtra(EXTRA_FILES) ?: return START_NOT_STICKY
                val startAt  = intent.getIntExtra(EXTRA_START, 0)
                speed  = intent.getFloatExtra(EXTRA_SPEED, 1f).coerceIn(0.5f, 3f)
                volume = intent.getFloatExtra(EXTRA_VOLUME, 1f).coerceIn(0f, 1f)
                startQueue(newFiles, startAt)
            }
        }
        return START_NOT_STICKY
    }

    private fun startQueue(newFiles: List<String>, startAt: Int) {
        stopPlayback()
        files = newFiles
        currentIndex = startAt.coerceIn(0, maxOf(0, newFiles.size - 1))
        if (files.isEmpty()) { broadcastFinished(); stopSelf(); return }
        requestAudioFocus()
        showNotification("Playing…")
        playNext()
    }

    private fun playNext() {
        if (currentIndex >= files.size) { onQueueFinished(); return }
        broadcastProgress(currentIndex)
        val path = files[currentIndex]
        try {
            val mp = MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build())
                setDataSource(path)
                prepare()
                if (Build.VERSION.SDK_INT >= 23) playbackParams = playbackParams.setSpeed(speed)
                setVolume(volume, volume)
                setOnCompletionListener { onFileCompleted() }
                setOnErrorListener { _, what, extra ->
                    broadcastError("MediaPlayer error $what/$extra on $path")
                    onFileCompleted()
                    true
                }
                start()
            }
            player = mp
        } catch (e: Exception) {
            broadcastError("Could not play $path: ${e.message}")
            currentIndex++
            playNext()
        }
    }

    private fun onFileCompleted() {
        player?.release()
        player = null
        currentIndex++
        playNext()
    }

    private fun onQueueFinished() {
        broadcastFinished()
        abandonAudioFocus()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun stopPlayback() {
        player?.let { if (it.isPlaying) it.stop(); it.release() }
        player = null
        abandonAudioFocus()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        player?.let { try { if (it.isPlaying) it.stop() } catch (_: Exception) {}; it.release() }
        player = null
        abandonAudioFocus()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── Audio focus ──────────────────────────────────────────────────────────

    private fun requestAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build())
                .setOnAudioFocusChangeListener { change ->
                    if (change == AudioManager.AUDIOFOCUS_LOSS) stopPlayback()
                    else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) player?.pause()
                    else if (change == AudioManager.AUDIOFOCUS_GAIN) player?.start()
                }
                .build()
            focusRequest = req
            audioManager?.requestAudioFocus(req)
        }
    }

    private fun abandonAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { audioManager?.abandonAudioFocusRequest(it) }
            focusRequest = null
        }
    }

    // ── Broadcasts ───────────────────────────────────────────────────────────

    private fun broadcastProgress(index: Int) = sendBroadcast(
        Intent(ACTION_PROGRESS).putExtra(EXTRA_INDEX, index))

    private fun broadcastFinished() = sendBroadcast(Intent(ACTION_FINISHED))

    private fun broadcastError(msg: String) = sendBroadcast(
        Intent(ACTION_ERROR).putExtra(EXTRA_MESSAGE, msg))

    // ── Notification ─────────────────────────────────────────────────────────

    private fun showNotification(label: String) {
        val openApp = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = PendingIntent.getActivity(
            this, 0, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stopIntent = Intent(this, AtlasAudioService::class.java).apply { action = ACTION_STOP }
        val stopPending = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Atlas")
            .setContentText(label)
            .setContentIntent(pending)
            .addAction(R.mipmap.ic_launcher, "Stop", stopPending)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID, "Audio playback", NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps audio playing when Atlas is in the background."
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
}
