package ai.offgridmobile.download

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface DownloadDao {
    @Query("SELECT * FROM downloads")
    fun getAllDownloads(): Flow<List<DownloadEntity>>

    @Query("SELECT * FROM downloads WHERE id = :downloadId")
    suspend fun getDownload(downloadId: String): DownloadEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDownload(download: DownloadEntity)

    @Delete
    suspend fun deleteDownload(download: DownloadEntity)

    @Query("UPDATE downloads SET downloadedBytes = :bytes, totalBytes = :totalBytes, status = :status WHERE id = :downloadId")
    suspend fun updateProgress(downloadId: String, bytes: Long, totalBytes: Long, status: DownloadStatus)

    @Query("UPDATE downloads SET status = :status, error = :error WHERE id = :downloadId")
    suspend fun updateStatus(downloadId: String, status: DownloadStatus, error: String? = null)

    /** Claim an active transfer for stopping without overwriting a completed or failed verdict. */
    @Query(
        """UPDATE downloads SET status = 'CANCELLED', error = :reason
           WHERE id = :downloadId
             AND status IN ('QUEUED', 'RUNNING', 'RETRYING', 'WAITING_FOR_NETWORK')""",
    )
    suspend fun markStopRequested(downloadId: String, reason: String): Int
}
