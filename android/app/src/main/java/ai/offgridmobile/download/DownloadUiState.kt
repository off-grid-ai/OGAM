package ai.offgridmobile.download

import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/** Writing downloaded bytes to the phone's storage failed (as opposed to reading them from the network). */
class DiskWriteException(cause: IOException) : Exception(cause.message, cause) {
    fun isOutOfSpace(): Boolean {
        val text = generateSequence(cause) { it.cause }.joinToString(" ") { it.message.orEmpty() }
        return text.contains("ENOSPC") || text.contains("No space left", ignoreCase = true)
    }
}

data class DownloadUiState(
    val status: String,
    val reason: String? = null,
    val reasonCode: String? = null,
)

object DownloadReason {
    const val NONE = "none"
    const val NETWORK_LOST = "network_lost"
    const val NETWORK_TIMEOUT = "network_timeout"
    const val SERVER_UNAVAILABLE = "server_unavailable"
    const val DOWNLOAD_INTERRUPTED = "download_interrupted"
    const val DISK_FULL = "disk_full"
    const val FILE_CORRUPTED = "file_corrupted"
    const val EMPTY_RESPONSE = "empty_response"
    const val USER_CANCELLED = "user_cancelled"
    const val HTTP_401 = "http_401"
    const val HTTP_403 = "http_403"
    const val HTTP_404 = "http_404"
    const val HTTP_416 = "http_416"
    const val HTTP_429 = "http_429"
    const val CLIENT_ERROR = "client_error"
    const val UNKNOWN_ERROR = "unknown_error"

    private val retryableCodes = setOf(
        NETWORK_LOST,
        NETWORK_TIMEOUT,
        SERVER_UNAVAILABLE,
        DOWNLOAD_INTERRUPTED,
        HTTP_429,
    )

    fun fromThrowable(error: Exception): String {
        return when (error) {
            // A failed write to the phone's storage is not a network cut: a full disk says so, and any
            // other write failure is not retried as if the connection had dropped.
            is DiskWriteException -> if (error.isOutOfSpace()) DISK_FULL else UNKNOWN_ERROR
            is SocketTimeoutException -> NETWORK_TIMEOUT
            is InterruptedIOException -> NETWORK_TIMEOUT
            is UnknownHostException -> NETWORK_LOST
            is ConnectException -> NETWORK_LOST
            is SocketException -> NETWORK_LOST
            is SSLException -> NETWORK_LOST
            // Any other I/O failure mid-transfer (a CDN stream reset, "unexpected end of stream") is an
            // interrupted transfer, not an unknown one: the partial file is kept and resumes with Range.
            // As UNKNOWN_ERROR it was never retried, so one reset failed the whole download.
            is IOException -> DOWNLOAD_INTERRUPTED
            else -> UNKNOWN_ERROR
        }
    }

    /**
     * Resume straight away, in the same worker, after a retryable failure that came after new bytes:
     * the download is still moving, so it costs none of WorkManager's retries (the file is finite, so
     * this ends). Only a request that wrote nothing, or a run past MAX_IN_PLACE_RESUMES, waits for a
     * WorkManager retry.
     */
    fun resumesInPlace(code: String, madeProgress: Boolean, resumesSoFar: Int = 0): Boolean =
        madeProgress && isRetryable(code) && resumesSoFar < MAX_IN_PLACE_RESUMES

    /** A connection that writes a little and drops every time still ends the worker, so WorkManager's
     *  bounded retries apply: a long download on a bad network resumes this often per run. */
    const val MAX_IN_PLACE_RESUMES = 20

    fun fromHttpCode(code: Int): String {
        return when (code) {
            401 -> HTTP_401
            403 -> HTTP_403
            404 -> HTTP_404
            416 -> HTTP_416
            429 -> HTTP_429
            in 500..599 -> SERVER_UNAVAILABLE
            in 400..499 -> CLIENT_ERROR
            else -> UNKNOWN_ERROR
        }
    }

    fun isRetryable(code: String?): Boolean = code != null && retryableCodes.contains(code)

    fun messageFor(code: String?): String? {
        return when (code) {
            NETWORK_LOST -> "Network connection lost."
            NETWORK_TIMEOUT -> "The download timed out."
            SERVER_UNAVAILABLE -> "The download server is temporarily unavailable."
            DOWNLOAD_INTERRUPTED -> "The download was interrupted."
            DISK_FULL -> "Not enough storage space for this download."
            FILE_CORRUPTED -> "The downloaded file failed verification."
            EMPTY_RESPONSE -> "The download server returned an empty response."
            USER_CANCELLED -> "Download cancelled."
            HTTP_401 -> "The download server rejected access to this file."
            HTTP_403 -> "The download server rejected access to this file."
            HTTP_404 -> "The file could not be found on the download server."
            HTTP_416 -> "The server could not resume this download. Please retry it."
            HTTP_429 -> "Rate limited by the download server."
            CLIENT_ERROR -> "The download request was rejected by the server."
            UNKNOWN_ERROR -> "Something went wrong while downloading."
            else -> null
        }
    }

    fun toUiState(status: DownloadStatus, code: String?): DownloadUiState {
        val normalizedCode = code?.ifBlank { null }
        return when (status) {
            DownloadStatus.RUNNING -> DownloadUiState(status = "running")
            DownloadStatus.PAUSED -> DownloadUiState(status = "paused")
            DownloadStatus.COMPLETED -> DownloadUiState(status = "completed")
            DownloadStatus.CANCELLED -> DownloadUiState(
                status = "cancelled",
                reason = messageFor(USER_CANCELLED),
                reasonCode = USER_CANCELLED,
            )
            DownloadStatus.FAILED -> DownloadUiState(
                status = "failed",
                reason = messageFor(normalizedCode ?: UNKNOWN_ERROR),
                reasonCode = normalizedCode ?: UNKNOWN_ERROR,
            )
            DownloadStatus.RETRYING -> DownloadUiState(
                status = "failed",
                reason = messageFor(normalizedCode ?: DOWNLOAD_INTERRUPTED),
                reasonCode = normalizedCode ?: DOWNLOAD_INTERRUPTED,
            )
            DownloadStatus.WAITING_FOR_NETWORK -> DownloadUiState(
                status = "waiting_for_network",
                reason = messageFor(NETWORK_LOST),
                reasonCode = NETWORK_LOST,
            )
            DownloadStatus.QUEUED -> DownloadUiState(
                status = "pending",
                reason = messageFor(normalizedCode),
                reasonCode = normalizedCode,
            )
        }
    }
}
