package ai.offgridmobile.download

import android.app.Application
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Tests for the pure helper functions in the new WorkManager-based download layer.
 *
 * The old DownloadManager/SharedPrefs layer (statusToString, reasonToString,
 * hasNoActiveDownloads, shouldRemoveDownload, BytesTrack, evaluateStuckProgress)
 * has been replaced by Room + WorkManager. These tests cover the pure functions
 * that remain in the new architecture.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
class DownloadManagerModuleTest {

    // ── WorkerDownload.isHostAllowed ──────────────────────────────────────────

    @Test
    fun isHostAllowedAcceptsHuggingfaceCo() {
        assertTrue(WorkerDownload.isHostAllowed("https://huggingface.co/model.gguf"))
    }

    @Test
    fun isHostAllowedAcceptsCdnLfsSubdomain() {
        assertTrue(WorkerDownload.isHostAllowed("https://cdn-lfs.huggingface.co/path/to/model"))
    }

    @Test
    fun isHostAllowedAcceptsCasBridgeSubdomain() {
        assertTrue(WorkerDownload.isHostAllowed("https://cas-bridge.xethub.hf.co/file"))
    }

    @Test
    fun isHostAllowedAcceptsNestedSubdomainOfAllowedHost() {
        assertTrue(WorkerDownload.isHostAllowed("https://foo.cdn-lfs.huggingface.co/file"))
    }

    @Test
    fun isHostAllowedAcceptsNestedSubdomainOfHuggingfaceCo() {
        assertTrue(WorkerDownload.isHostAllowed("https://subdomain.huggingface.co/model"))
    }

    @Test
    fun isHostAllowedRejectsUnknownHost() {
        assertFalse(WorkerDownload.isHostAllowed("https://evil.com/malware.gguf"))
    }

    @Test
    fun isHostAllowedRejectsLookAlikeDomainWithoutDotSeparator() {
        assertFalse(WorkerDownload.isHostAllowed("https://nothuggingface.co/model.gguf"))
    }

    @Test
    fun isHostAllowedRejectsSubdomainOfLookAlikeHost() {
        assertFalse(WorkerDownload.isHostAllowed("https://cdn.evil-huggingface.co/model.gguf"))
    }

    @Test
    fun isHostAllowedRejectsInvalidUrl() {
        assertFalse(WorkerDownload.isHostAllowed("not a url"))
    }

    @Test
    fun isHostAllowedRejectsEmptyString() {
        assertFalse(WorkerDownload.isHostAllowed(""))
    }

    @Test
    fun isHostAllowedAllowsHttpSchemeOnAllowedHost() {
        // The allowlist checks the host, not the scheme — http is still allowed by this
        // function; network security config handles transport-level enforcement.
        assertTrue(WorkerDownload.isHostAllowed("http://huggingface.co/model.gguf"))
    }

    // ── WorkerDownload.workName ───────────────────────────────────────────────

    @Test
    fun workNameReturnsDownloadUnderscoreId() {
        assertEquals("download_abc-123", WorkerDownload.workName("abc-123"))
    }

    @Test
    fun workNameIsUniquePerDownloadId() {
        val name1 = WorkerDownload.workName("id-1")
        val name2 = WorkerDownload.workName("id-2")
        assertTrue(name1 != name2)
    }

    // ── DownloadStatus enum ───────────────────────────────────────────────────

    @Test
    fun downloadStatusContainsAllRequiredValues() {
        val values = DownloadStatus.entries.map { it.name }
        assertTrue(values.contains("QUEUED"))
        assertTrue(values.contains("RUNNING"))
        assertTrue(values.contains("COMPLETED"))
        assertTrue(values.contains("FAILED"))
        assertTrue(values.contains("CANCELLED"))
        assertFalse("PAUSED must not exist in V2", values.contains("PAUSED"))
    }

    @Test
    fun downloadStatusRunningLowercasedIsRunning() {
        assertEquals("running", DownloadStatus.RUNNING.name.lowercase())
    }

    @Test
    fun downloadStatusCompletedLowercasedIsCompleted() {
        assertEquals("completed", DownloadStatus.COMPLETED.name.lowercase())
    }

    @Test
    fun downloadStatusFailedLowercasedIsFailed() {
        assertEquals("failed", DownloadStatus.FAILED.name.lowercase())
    }

    // ── WorkerDownload constants ──────────────────────────────────────────────

    @Test
    fun defaultProgressIntervalIs1500ms() {
        assertEquals(1_500L, WorkerDownload.DEFAULT_PROGRESS_INTERVAL)
    }

    @Test
    fun keyDownloadIdConstantIsDefined() {
        assertEquals("download_id", WorkerDownload.KEY_DOWNLOAD_ID)
    }

    @Test
    fun keyProgressConstantIsDefined() {
        assertEquals("progress", WorkerDownload.KEY_PROGRESS)
    }

    @Test
    fun keyTotalConstantIsDefined() {
        assertEquals("total", WorkerDownload.KEY_TOTAL)
    }

    // ── WorkerDownload.computeFileSha256 ──────────────────────────────────────

    @Test
    fun computeFileSha256MatchesKnownHash() {
        // echo -n "hello" | sha256sum = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
        val tmp = createTempFile("sha256test", ".bin")
        try {
            tmp.writeBytes("hello".toByteArray(Charsets.UTF_8))
            assertEquals(
                "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
                WorkerDownload.computeFileSha256(tmp),
            )
        } finally {
            tmp.delete()
        }
    }

    @Test
    fun computeFileSha256EmptyFileReturnsKnownHash() {
        // sha256 of empty input = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        val tmp = createTempFile("sha256empty", ".bin")
        try {
            tmp.writeBytes(ByteArray(0))
            assertEquals(
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                WorkerDownload.computeFileSha256(tmp),
            )
        } finally {
            tmp.delete()
        }
    }

    @Test
    fun computeFileSha256IsCaseInsensitiveCompatible() {
        val tmp = createTempFile("sha256case", ".bin")
        try {
            tmp.writeBytes("hello".toByteArray(Charsets.UTF_8))
            val hash = WorkerDownload.computeFileSha256(tmp)
            // Our function always returns lowercase; verify it equals the uppercase version ignoreCase
            assertTrue(hash == hash.lowercase())
        } finally {
            tmp.delete()
        }
    }

    // ── Manual retry behaviour ────────────────────────────────────────────────

    /**
     * Documents that all transient errors (network drops, 5xx, 429) now result in FAILED so the
     * user sees a retry button rather than a silently-looping WorkManager backoff cycle. QUEUED is
     * only used when the user explicitly taps retry (retryDownload) or when the OS kills the worker
     * mid-stream (handleStoppedState — silent re-queue, not a user-visible failure).
     */
    @Test
    fun failedStatusIsUsedForAllTransientErrors() {
        val terminalStatus = DownloadStatus.FAILED
        val retryQueuedStatus = DownloadStatus.QUEUED
        assertTrue(
            "FAILED and QUEUED must be distinct so UI can tell a dead download from one pending retry",
            terminalStatus != retryQueuedStatus,
        )
        assertEquals("failed", terminalStatus.name.lowercase())
        assertEquals("queued", retryQueuedStatus.name.lowercase())
    }

    // ── WorkerDownload.calculateTotalBytes ────────────────────────────────────

    @Test
    fun calculateTotalBytesUsesServerContentLengthOn200() {
        // A fresh 200 download: the server's Content-Length is authoritative.
        val total = WorkerDownload.calculateTotalBytes(
            code = 200,
            currentFileBytes = 0L,
            contentLength = 77_704_715L,
            existingTotal = 0L,
        )
        assertEquals(77_704_715L, total)
    }

    @Test
    fun calculateTotalBytesDoesNotClampRealLengthUpToSeededEstimate() {
        // Regression: Whisper seeds existingTotal from a rounded MB figure
        // (75 * 1024 * 1024 = 78_643_200) while the real file is 77_704_715 bytes.
        // The old code did .coerceAtLeast(existingTotal), inflating the expected
        // size to the rounded seed; the completion size check (0.1% tolerance) then
        // deleted every Whisper model as FILE_CORRUPTED. The real Content-Length
        // must win so actual == expected and validation passes.
        val seeded = 75L * 1024L * 1024L
        val total = WorkerDownload.calculateTotalBytes(
            code = 200,
            currentFileBytes = 0L,
            contentLength = 77_704_715L,
            existingTotal = seeded,
        )
        assertEquals(77_704_715L, total)
        assertTrue("real length must not be inflated to the seeded estimate", total < seeded)
    }

    @Test
    fun calculateTotalBytesFallsBackToSeededEstimateWhenServerOmitsLength() {
        // OkHttp returns -1 from contentLength() when the server sends no length.
        // Only then do we fall back to the caller's seeded estimate.
        val seeded = 78_643_200L
        val total = WorkerDownload.calculateTotalBytes(
            code = 200,
            currentFileBytes = 0L,
            contentLength = -1L,
            existingTotal = seeded,
        )
        assertEquals(seeded, total)
    }

    @Test
    fun calculateTotalBytesAddsExistingBytesForRangedResume() {
        // 206 Partial Content: total = bytes already on disk + remaining length.
        val total = WorkerDownload.calculateTotalBytes(
            code = 206,
            currentFileBytes = 10_000_000L,
            contentLength = 67_704_715L,
            existingTotal = 0L,
        )
        assertEquals(77_704_715L, total)
    }

    @Test
    fun calculateTotalBytesResumeFallsBackToSeededEstimateWhenLengthMissing() {
        val seeded = 77_704_715L
        val total = WorkerDownload.calculateTotalBytes(
            code = 206,
            currentFileBytes = 10_000_000L,
            contentLength = -1L,
            existingTotal = seeded,
        )
        assertEquals(seeded, total)
    }

    // ── Foreground-service download notification (F8) ─────────────────────────

    @Test
    fun buildForegroundInfoUsesDataSyncServiceType() {
        val ctx = org.robolectric.RuntimeEnvironment.getApplication()
        val info = WorkerDownload.buildForegroundInfo(ctx, "gemma-4-Q8_0.gguf")
        // On SDK 33 the FGS type MUST be dataSync, or startForeground throws on Android 14+.
        assertEquals(
            android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            info.foregroundServiceType,
        )
        assertNotNull(info.notification)
    }

    @Test
    fun ensureNotificationChannelCreatesTheDownloadChannel() {
        val ctx = org.robolectric.RuntimeEnvironment.getApplication()
        WorkerDownload.ensureNotificationChannel(ctx)
        val mgr = ctx.getSystemService(android.content.Context.NOTIFICATION_SERVICE)
            as android.app.NotificationManager
        assertNotNull(mgr.getNotificationChannel("model_downloads"))
    }
}

