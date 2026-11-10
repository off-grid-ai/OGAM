package ai.offgridmobile.download

import okhttp3.internal.http2.ErrorCode
import okhttp3.internal.http2.StreamResetException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.EOFException
import java.io.IOException
import java.net.SocketException
import java.net.SocketTimeoutException

class DownloadReasonTest {
    @Test
    fun `a CDN stream reset mid-transfer is an interrupted transfer, which is retried`() {
        // Was UNKNOWN_ERROR, which is never retried: one reset failed the whole download.
        val code = DownloadReason.fromThrowable(StreamResetException(ErrorCode.INTERNAL_ERROR))
        assertEquals(DownloadReason.DOWNLOAD_INTERRUPTED, code)
        assertTrue(DownloadReason.isRetryable(code))
    }

    @Test
    fun `an unexpected end of stream is an interrupted transfer`() {
        assertEquals(DownloadReason.DOWNLOAD_INTERRUPTED, DownloadReason.fromThrowable(EOFException("unexpected end of stream")))
        assertEquals(DownloadReason.DOWNLOAD_INTERRUPTED, DownloadReason.fromThrowable(IOException("closed")))
    }

    @Test
    fun `network and timeout failures keep their own codes, and a non-IO failure stays unknown`() {
        assertEquals(DownloadReason.NETWORK_LOST, DownloadReason.fromThrowable(SocketException("reset")))
        assertEquals(DownloadReason.NETWORK_TIMEOUT, DownloadReason.fromThrowable(SocketTimeoutException()))
        val unknown = DownloadReason.fromThrowable(IllegalStateException("bug"))
        assertEquals(DownloadReason.UNKNOWN_ERROR, unknown)
        assertFalse(DownloadReason.isRetryable(unknown))
    }

    @Test
    fun `a transfer that wrote bytes resumes in place, one that wrote nothing does not`() {
        assertTrue(DownloadReason.resumesInPlace(DownloadReason.DOWNLOAD_INTERRUPTED, madeProgress = true))
        assertFalse(DownloadReason.resumesInPlace(DownloadReason.DOWNLOAD_INTERRUPTED, madeProgress = false))
        // A failure that a retry cannot fix never loops, even after progress.
        assertFalse(DownloadReason.resumesInPlace(DownloadReason.DISK_FULL, madeProgress = true))
        assertFalse(DownloadReason.resumesInPlace(DownloadReason.UNKNOWN_ERROR, madeProgress = true))
    }

    @Test
    fun `a full disk while writing is disk_full, not a network cut, and is never resumed in place`() {
        val full = DiskWriteException(IOException("write failed: ENOSPC (No space left on device)"))
        assertEquals(DownloadReason.DISK_FULL, DownloadReason.fromThrowable(full))
        assertFalse(DownloadReason.resumesInPlace(DownloadReason.fromThrowable(full), madeProgress = true))
        assertEquals(DownloadReason.UNKNOWN_ERROR, DownloadReason.fromThrowable(DiskWriteException(IOException("EIO"))))
    }

    @Test
    fun `a connection that keeps dropping stops resuming in place after the cap`() {
        val code = DownloadReason.DOWNLOAD_INTERRUPTED
        assertTrue(DownloadReason.resumesInPlace(code, madeProgress = true, resumesSoFar = DownloadReason.MAX_IN_PLACE_RESUMES - 1))
        assertFalse(DownloadReason.resumesInPlace(code, madeProgress = true, resumesSoFar = DownloadReason.MAX_IN_PLACE_RESUMES))
    }
}
