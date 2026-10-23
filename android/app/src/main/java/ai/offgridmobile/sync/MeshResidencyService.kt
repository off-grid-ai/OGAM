package ai.offgridmobile.sync

import android.app.ForegroundServiceStartNotAllowedException
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Keeps the Personal Mesh reachable while Off Grid is not in the foreground.
 *
 * Without this, Android suspends the process and mDNS discovery, the TCP listener and any in-flight
 * transfer stop, while the other device still shows this one as connected. Android classifies this
 * live local-device connection as connectedDevice work. That type is not subject to dataSync's
 * six-hour budget. The ongoing notification keeps background reachability visible, never silent.
 */
class MeshResidencyService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val generation = intent?.getLongExtra(EXTRA_GENERATION, -1L) ?: -1L
        try {
            // Every startForegroundService() must be answered with startForeground(), even when the
            // request is already stale. Stopping first makes Android crash the app with
            // ForegroundServiceDidNotStartInTimeException. The start stays pending until then, so a
            // stop that arrives while the notification is built cannot stop the service first.
            if (intent != null) promoteAccepted { startForegroundCompat() } else startForegroundCompat()
            if (!isCurrentGeneration(generation)) {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf(startId)
                return START_NOT_STICKY
            }
            publish(generation, ResidencySnapshot("background"))
        } catch (error: RuntimeException) {
            val startWasDenied =
                error is SecurityException ||
                    (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                        error is ForegroundServiceStartNotAllowedException)
            if (!startWasDenied) throw error

            // Promotion can be denied after startForegroundService() has already returned. Stop
            // this service now so Android does not later kill the process for a late promotion.
            publish(
                generation,
                ResidencySnapshot("foreground_only", "promotion_denied"),
            )
            stopImmediately()
        }

        // The React Native mesh engine owns the sockets. A service-only restart would show a false
        // reachability notification and can also occur when Android does not permit a new FGS.
        return START_NOT_STICKY
    }

    /** Android gives a timed foreground service only a few seconds to stop after this callback. */
    override fun onTimeout(startId: Int, fgsType: Int) {
        publishCurrent(ResidencySnapshot("foreground_only", "timed_out"))
        stopImmediately()
    }

    private fun stopImmediately() {
        residencyRequested.set(false)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        residencyRequested.set(false)
        markUnexpectedStop()
        super.onDestroy()
    }

    private fun startForegroundCompat() {
        val notification = buildNotification(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                FOREGROUND_SERVICE_TYPE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        const val CHANNEL_ID = "offgrid-personal-mesh"
        const val NOTIFICATION_ID = 4711
        const val FOREGROUND_SERVICE_TYPE =
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        private const val EXTRA_GENERATION = "mesh_residency_generation"
        private const val PROMOTION_DEADLINE_MS = 5_000L
        private val residencyRequested = AtomicBoolean(false)

        private val mainHandler = Handler(Looper.getMainLooper())
        private val lock = Any()

        /**
         * Foreground starts Android may have accepted that have not finished promoting. While one is
         * pending, the service must not be stopped from outside: it has not promoted yet, and a stop
         * now crashes the app. The service promotes and then stops itself as a stale start. Guarded
         * by [lock], so registering a start and deciding to stop never interleave.
         */
        private var pendingStarts = 0
        private var activeGeneration = 0L
        private var snapshot = ResidencySnapshot("inactive")
        private val waiters = mutableListOf<(ResidencySnapshot) -> Unit>()

        data class ResidencySnapshot(
            val status: String,
            val reason: String? = null,
        ) {
            /** Project service state into the only map type that can cross the React Native bridge. */
            fun toWritableMap(target: WritableMap = Arguments.createMap()): WritableMap =
                target.apply {
                    putString("status", status)
                    if (reason == null) putNull("reason") else putString("reason", reason)
                }
        }

        /**
         * Ensure the channel exists before the first foreground start.
         *
         * IMPORTANCE_LOW keeps the notification silent: it is a status indicator, not an alert.
         */
        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager =
                context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (manager.getNotificationChannel(CHANNEL_ID) != null) return
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Personal Mesh",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "Shown while this device stays reachable to your other devices."
                    setShowBadge(false)
                },
            )
        }

        fun buildNotification(context: Context): Notification =
            NotificationCompat.Builder(context, CHANNEL_ID)
                .setContentTitle("Personal Mesh is on")
                .setContentText("This device stays reachable to your other devices.")
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()

        fun start(context: Context, onResult: (ResidencySnapshot) -> Unit) {
            val generation: Long
            synchronized(lock) {
                if (snapshot.status == "background") {
                    onResult(snapshot)
                    return
                }
                if (snapshot.status == "starting") {
                    waiters.add(onResult)
                    return
                }
                activeGeneration += 1
                generation = activeGeneration
                snapshot = ResidencySnapshot("starting")
                waiters.add(onResult)
            }
            residencyRequested.set(true)
            // Registered before Android can accept the start: a stop in between must wait for it.
            synchronized(lock) { pendingStarts += 1 }
            try {
                ensureChannel(context)
                val intent =
                    Intent(context, MeshResidencyService::class.java)
                        .putExtra(EXTRA_GENERATION, generation)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (_: RuntimeException) {
                // Android refused the start, so no service will promote: nothing is pending.
                synchronized(lock) { pendingStarts -= 1 }
                residencyRequested.set(false)
                publish(
                    generation,
                    ResidencySnapshot("foreground_only", "promotion_denied"),
                )
            }
            mainHandler.postDelayed({
                val timedOut = publish(
                    generation,
                    ResidencySnapshot("foreground_only", "promotion_timeout"),
                    onlyIfStarting = true,
                )
                if (timedOut) {
                    residencyRequested.set(false)
                    stopServiceIfPromoted(context)
                }
            }, PROMOTION_DEADLINE_MS)
        }

        fun stop(context: Context) {
            residencyRequested.set(false)
            synchronized(lock) {
                activeGeneration += 1
                snapshot = ResidencySnapshot("inactive")
                val pending = waiters.toList()
                waiters.clear()
                pending.forEach { it(snapshot) }
            }
            stopServiceIfPromoted(context)
        }

        private fun stopServiceIfPromoted(context: Context) {
            synchronized(lock) {
                if (pendingStarts > 0) return
                context.stopService(Intent(context, MeshResidencyService::class.java))
            }
        }

        /** Tests only: starts a test never delivered would otherwise stay pending into the next test. */
        @androidx.annotation.VisibleForTesting
        internal fun forgetPendingStarts() = synchronized(lock) { pendingStarts = 0 }

        /** Runs one accepted start's promotion; the start stays pending until the attempt ends. */
        internal fun promoteAccepted(promote: () -> Unit) {
            try {
                promote()
            } finally {
                synchronized(lock) { if (pendingStarts > 0) pendingStarts -= 1 }
            }
        }

        fun currentSnapshot(): ResidencySnapshot = synchronized(lock) { snapshot }

        private fun isCurrentGeneration(generation: Long): Boolean =
            synchronized(lock) { generation == activeGeneration && snapshot.status == "starting" }

        private fun publishCurrent(next: ResidencySnapshot) {
            val generation = synchronized(lock) { activeGeneration }
            publish(generation, next)
        }

        private fun markUnexpectedStop() {
            val generation = synchronized(lock) {
                if (snapshot.status == "background") activeGeneration else null
            } ?: return
            publish(generation, ResidencySnapshot("foreground_only", "unavailable"))
        }

        private fun publish(
            generation: Long,
            next: ResidencySnapshot,
            onlyIfStarting: Boolean = false,
        ): Boolean {
            val pending: List<(ResidencySnapshot) -> Unit>
            synchronized(lock) {
                if (generation != activeGeneration) return false
                if (onlyIfStarting && snapshot.status != "starting") return false
                snapshot = next
                pending = waiters.toList()
                waiters.clear()
            }
            pending.forEach { it(next) }
            return true
        }
    }
}
