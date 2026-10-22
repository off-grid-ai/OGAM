package ai.offgridmobile.sync

import android.Manifest
import android.app.Application
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.mockito.ArgumentCaptor
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class MeshResidencyServiceTest {
    @Before
    fun startClean() {
        MeshResidencyService.forgetPendingStarts()
    }

    @After
    fun releaseResidency() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        MeshResidencyService.stop(context)
    }

    @Test
    fun personalMeshUsesConnectedDeviceForegroundServiceContract() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val serviceInfo =
            context.packageManager.getServiceInfo(
                ComponentName(context, MeshResidencyService::class.java),
                PackageManager.ComponentInfoFlags.of(0),
            )

        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            MeshResidencyService.FOREGROUND_SERVICE_TYPE,
        )
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            serviceInfo.foregroundServiceType,
        )

        val requestedPermissions =
            context.packageManager
                .getPackageInfo(
                    context.packageName,
                    PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()),
                ).requestedPermissions.orEmpty()

        assertTrue(
            requestedPermissions.contains(Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE),
        )
        assertTrue(
            requestedPermissions.contains(Manifest.permission.CHANGE_WIFI_MULTICAST_STATE),
        )
    }

    @Test
    fun beginResolvesAReactNativeWritableMapAfterTheServicePublishesBackground() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        MeshResidencyService.start(context) {}
        val startIntent = shadowOf(context as Application).nextStartedService
        val service =
            org.robolectric.Robolectric
                .buildService(MeshResidencyService::class.java)
                .create()
                .get()
        service.onStartCommand(startIntent, 0, 16)

        val reactContext = mock(ReactApplicationContext::class.java)
        val promise = mock(Promise::class.java)
        val module = MeshResidencyModule(reactContext) { JavaOnlyMap() }

        module.begin(promise)

        val resolved = ArgumentCaptor.forClass(Any::class.java)
        verify(promise).resolve(resolved.capture())
        val result = resolved.value as WritableMap
        assertEquals("background", result.getString("status"))
        assertTrue(result.isNull("reason"))
    }

    @Test
    @Config(sdk = [34], application = Application::class)
    fun timeoutStopsResidencyImmediately() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        var startedStatus: String? = null
        MeshResidencyService.start(context) { startedStatus = it.status }
        val startIntent = shadowOf(context as Application).nextStartedService
        val service =
            org.robolectric.Robolectric
                .buildService(MeshResidencyService::class.java)
                .create()
                .get()

        service.onStartCommand(startIntent, 0, 17)
        assertEquals("background", startedStatus)
        service.onTimeout(17, MeshResidencyService.FOREGROUND_SERVICE_TYPE)

        val shadow = shadowOf(service)
        assertTrue(shadow.isForegroundStopped)
        assertTrue(shadow.notificationShouldRemoved)
        assertTrue(shadow.isStoppedBySelf)

        var restartedStatus: String? = null
        MeshResidencyService.start(context) { restartedStatus = it.status }
        assertNotNull(shadowOf(context as Application).nextStartedService)
        assertEquals("starting", MeshResidencyService.currentSnapshot().status)
        assertEquals(null, restartedStatus)
    }

    @Test
    fun serviceDoesNotRestartWithoutItsMeshOwner() {
        val service =
            org.robolectric.Robolectric
                .buildService(MeshResidencyService::class.java)
                .create()
                .get()

        val restartMode = service.onStartCommand(null, 0, 18)

        assertEquals(Service.START_NOT_STICKY, restartMode)
    }

    @Test
    fun timeoutIsProjectedAsForegroundOnlyInsteadOfBackgroundRunning() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        MeshResidencyService.start(context) {}
        val startIntent = shadowOf(context as Application).nextStartedService
        val service =
            org.robolectric.Robolectric
                .buildService(MeshResidencyService::class.java)
                .create()
                .get()

        service.onStartCommand(startIntent, 0, 19)
        service.onTimeout(19, MeshResidencyService.FOREGROUND_SERVICE_TYPE)

        assertEquals("foreground_only", MeshResidencyService.currentSnapshot().status)
        assertEquals("timed_out", MeshResidencyService.currentSnapshot().reason)
    }

    @Test
    fun stopPublishesInactiveToAPendingBeginWaiter() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        var resultStatus: String? = null
        var resultReason: String? = "not_resolved"

        MeshResidencyService.start(context) {
            resultStatus = it.status
            resultReason = it.reason
        }
        MeshResidencyService.stop(context)

        assertEquals("inactive", resultStatus)
        assertEquals(null, resultReason)
    }

    @Test
    fun unexpectedServiceStopRemovesTheBackgroundReachabilityClaim() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        MeshResidencyService.start(context) {}
        val startIntent = shadowOf(context as Application).nextStartedService
        val controller =
            org.robolectric.Robolectric
                .buildService(MeshResidencyService::class.java)
                .create()
        val service = controller.get()

        service.onStartCommand(startIntent, 0, 20)
        controller.destroy()

        assertEquals("foreground_only", MeshResidencyService.currentSnapshot().status)
        assertEquals("unavailable", MeshResidencyService.currentSnapshot().reason)
    }

    @Test
    fun aStartThatIsStoppedBeforeDeliveryStillPromotesThenStopsItself() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val app = context as Application
        MeshResidencyService.start(context) {}
        val startIntent = shadowOf(app).nextStartedService

        // A short discovery blip: the mesh releases residency before Android delivers the start.
        MeshResidencyService.stop(context)
        assertEquals(
            "An unpromoted foreground service must not be stopped from outside",
            null,
            shadowOf(app).nextStoppedService,
        )

        val service =
            org.robolectric.Robolectric
                .buildService(MeshResidencyService::class.java)
                .create()
                .get()
        service.onStartCommand(startIntent, 0, 21)

        val shadow = shadowOf(service)
        // Promotion is visible by its service type; the notification itself is removed on stop.
        assertEquals(
            "The stale start must still promote",
            MeshResidencyService.FOREGROUND_SERVICE_TYPE,
            service.foregroundServiceType,
        )
        assertTrue(shadow.isForegroundStopped)
        assertTrue(shadow.isStoppedBySelf)
        assertEquals("inactive", MeshResidencyService.currentSnapshot().status)
    }
    /** Records stopService calls; [onAccepted] runs the moment Android accepts a foreground start. */
    private class RecordingContext(base: Context) : ContextWrapper(base) {
        var onAccepted: () -> Unit = {}
        var refuseStart = false
        var stops = 0

        override fun startForegroundService(service: Intent): ComponentName? {
            if (refuseStart) throw IllegalStateException("start not allowed")
            val accepted = super.startForegroundService(service)
            onAccepted()
            return accepted
        }

        override fun stopService(name: Intent): Boolean {
            stops += 1
            return super.stopService(name)
        }
    }

    @Test
    fun aStopRightAfterAndroidAcceptsTheStartWaitsForPromotion() {
        val recording = RecordingContext(ApplicationProvider.getApplicationContext())
        // The mesh releases residency the instant Android accepts the start, before any delivery.
        recording.onAccepted = { MeshResidencyService.stop(recording) }

        MeshResidencyService.start(recording) {}

        assertEquals("An accepted, unpromoted service must not be stopped from outside", 0, recording.stops)
    }

    @Test
    fun aStopDuringPromotionWaitsUntilPromotionEnds() {
        val recording = RecordingContext(ApplicationProvider.getApplicationContext())
        MeshResidencyService.start(recording) {}

        // A stop that lands while the service builds its notification, before startForeground.
        MeshResidencyService.promoteAccepted {
            MeshResidencyService.stop(recording)
            assertEquals("Stopped before promotion", 0, recording.stops)
        }

        // Once promoted, the next stop goes through.
        MeshResidencyService.stop(recording)
        assertEquals(1, recording.stops)
    }

    @Test
    fun aStartAndroidRefusedLeavesNothingPendingSoAStopGoesThrough() {
        val recording = RecordingContext(ApplicationProvider.getApplicationContext())
        recording.refuseStart = true
        var status: String? = null

        MeshResidencyService.start(recording) { status = it.status }
        MeshResidencyService.stop(recording)

        assertEquals("foreground_only", status)
        assertEquals(1, recording.stops)
    }
}
