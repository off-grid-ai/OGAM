package ai.offgridmobile.downloads

import android.Manifest
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.webkit.MimeTypeMap
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import java.io.File
import java.time.Instant

/**
 * The Downloads folder, read through MediaStore instead of the folder picker.
 *
 * Android 11 stopped letting `ACTION_OPEN_DOCUMENT_TREE` grant the Download directory at all - the
 * picker answers "For your safety, share another folder", which is the message users were getting.
 * So this device cannot offer downloads sharing through a folder grant, and MediaStore is the path
 * that exists: a media permission, no picker, and rows the system already indexes.
 *
 * The honest limit of that path, which the JavaScript side reports rather than hides: with a media
 * permission, MediaStore returns MEDIA in Download (images, video, audio). A PDF another app
 * downloaded is not media and is not visible without the folder grant Android now refuses or the
 * all-files permission Play restricts. So this shares your downloaded pictures and video, and says
 * so, instead of appearing to share everything and quietly missing half of it.
 */
class SyncDownloadsModule(
    private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
    private companion object {
        const val MAX_DISK_FILES = 5_000
        const val MAX_DISK_DEPTH = 4
    }

    override fun getName(): String = "SyncDownloadsModule"

    /** Export an app-owned file through scoped storage without broad media access. */
    @ReactMethod
    fun saveFileToDownloads(sourcePath: String, displayName: String, mimeType: String, promise: Promise) {
        Thread({
            var created: Uri? = null
            try {
                require(Build.VERSION.SDK_INT >= 29) { "Scoped Downloads requires Android 10." }
                val source = File(sourcePath).canonicalFile
                val roots = listOf(context.filesDir.canonicalFile, context.cacheDir.canonicalFile)
                require(roots.any { source.path.startsWith(it.path + File.separator) } && source.isFile) { "The file is outside app storage." }
                require(displayName == File(displayName).name && displayName.isNotBlank() && displayName.length <= 200) { "Invalid export filename." }
                require(mimeType in listOf("video/mp4", "image/png", "image/jpeg", "image/webp")) { "Unsupported media type." }
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
                    put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val uri = checkNotNull(context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values))
                created = uri
                checkNotNull(context.contentResolver.openOutputStream(uri)).use { output -> source.inputStream().use { it.copyTo(output) } }
                values.clear()
                values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                context.contentResolver.update(uri, values, null, null)
                promise.resolve(uri.toString())
            } catch (error: Throwable) {
                created?.let { runCatching { context.contentResolver.delete(it, null, null) } }
                promise.reject("MEDIA_EXPORT_FAILED", error.message, error)
            }
        }, "offgrid-media-export").start()
    }

    @ReactMethod
    fun hasPermission(promise: Promise) {
        promise.resolve(granted() || allFilesAccess())
    }

    /**
     * What access this device holds right now, so the words on screen can follow it.
     *
     * Two facts, because they buy different things: a media permission shows pictures and video in
     * Download, and all-files access shows the PDFs and zips that make up most of a real Downloads
     * folder. The JavaScript side turns these into the label on the button rather than guessing.
     */
    @ReactMethod
    fun accessState(promise: Promise) {
        promise.resolve(
            Arguments.createMap().apply {
                putBoolean("media", granted())
                putBoolean("allFiles", allFilesAccess())
                putBoolean("canRequestAllFiles", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
            },
        )
    }

    /**
     * Send the user to the system screen for all-files access.
     *
     * There is no in-app dialog for this one - Android only grants it from Settings - so this opens
     * that screen and resolves. The state is read again when the app comes back to the foreground,
     * which is also what happens if the user changes their mind and leaves it off.
     */
    @ReactMethod
    fun requestAllFilesAccess(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            promise.resolve(false)
            return
        }
        try {
            val intent = Intent(
                Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                Uri.parse("package:${context.packageName}"),
            )
            val activity = reactApplicationContext.currentActivity
            if (activity != null) {
                activity.startActivity(intent)
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
            }
            promise.resolve(true)
        } catch (error: Exception) {
            // The screen is missing on some builds; falling back to the app's own settings page is
            // better than a dead button, and all-files access is reachable from there.
            try {
                val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(fallback)
                promise.resolve(true)
            } catch (fallbackError: Exception) {
                promise.reject("downloads_all_files_unavailable", fallbackError)
            }
        }
    }

    /** Files in the Download folder, in the shape the shared directory source expects. */
    @ReactMethod
    fun enumerate(promise: Promise) {
        if (!granted() && !allFilesAccess()) {
            promise.reject(
                "downloads_permission_missing",
                "Off Grid AI needs access to your media to share downloads.",
            )
            return
        }
        try {
            // All-files access reads the folder itself, which is the only way to see a downloaded PDF:
            // MediaStore hands a media permission the media rows and nothing else.
            promise.resolve(if (allFilesAccess()) collectFromDisk() else collect())
        } catch (error: Exception) {
            promise.reject("downloads_enumeration_failed", error)
        }
    }

    /** Copy one row into the app so it stays shareable after the original is moved or deleted. */
    @ReactMethod
    fun stage(sourceId: String, destinationName: String, promise: Promise) {
        try {
            val directory = File(context.filesDir, "shared_files/download").apply { mkdirs() }
            val destination = availableDestination(directory, destinationName)
            // A MediaStore row is a content uri; a file read with all-files access is a path.
            val input = if (sourceId.startsWith("content://")) {
                context.contentResolver.openInputStream(Uri.parse(sourceId))
            } else {
                File(sourceId).takeIf { it.isFile }?.inputStream()
            }
            input.use { stream ->
                requireNotNull(stream) { "This download is no longer available." }
                destination.outputStream().use { output -> stream.copyTo(output) }
            }
            promise.resolve(
                Arguments.createMap().apply {
                    putString("filePath", destination.absolutePath)
                    putString("name", destination.name)
                },
            )
        } catch (error: Exception) {
            promise.reject("downloads_stage_failed", error)
        }
    }

    private fun collect(): WritableArray {
        val result = Arguments.createArray()
        val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)
        } else {
            @Suppress("DEPRECATION")
            MediaStore.Files.getContentUri("external")
        }
        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_MODIFIED,
        )
        val selection: String
        val args: Array<String>
        // A folder is a row here too, with no mime type and the block size for its length. Without
        // this it is offered as a shareable file, and staging it fails on every scan.
        val isFile = "${MediaStore.MediaColumns.MIME_TYPE} IS NOT NULL"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            selection = "${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ? AND $isFile"
            args = arrayOf("Download%")
        } else {
            @Suppress("DEPRECATION")
            selection = "${MediaStore.MediaColumns.DATA} LIKE ? AND $isFile"
            args = arrayOf("%/Download/%")
        }
        context.contentResolver.query(
            collection,
            projection,
            selection,
            args,
            "${MediaStore.MediaColumns.DATE_MODIFIED} DESC",
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                val id = cursor.getLong(0)
                val name = cursor.getString(1) ?: continue
                val declaredMime = cursor.getString(2)
                val fileSize = if (cursor.isNull(3)) 0L else cursor.getLong(3)
                // Seconds in MediaStore, milliseconds everywhere the shared source compares times.
                val modifiedAt = (if (cursor.isNull(4)) 0L else cursor.getLong(4)) * 1000L
                result.pushMap(
                    Arguments.createMap().apply {
                        putString("sourceId", Uri.withAppendedPath(collection, id.toString()).toString())
                        putString("name", name)
                        putString("mimeType", resolveMime(declaredMime, name))
                        putDouble("fileSize", fileSize.toDouble())
                        putString("createdAt", Instant.ofEpochMilli(modifiedAt.coerceAtLeast(0L)).toString())
                        putDouble("modifiedAt", modifiedAt.toDouble())
                    },
                )
            }
        }
        return result
    }

    /**
     * The Download folder read as a folder, which all-files access allows and MediaStore does not.
     *
     * Bounded on purpose: a real Downloads folder is years deep and thousands of files wide, and the
     * shared source only ever wants what arrived after watching started. Depth and count caps keep
     * one scan from walking a whole SD card.
     */
    private fun collectFromDisk(): WritableArray {
        val result = Arguments.createArray()
        @Suppress("DEPRECATION")
        val root = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        if (root == null || !root.isDirectory) return result
        val queue = ArrayDeque(listOf(root to 0))
        var count = 0
        while (queue.isNotEmpty() && count < MAX_DISK_FILES) {
            val (directory, depth) = queue.removeFirst()
            val entries = directory.listFiles() ?: continue
            for (entry in entries) {
                val name = entry.name
                if (name.startsWith(".")) continue
                if (entry.isDirectory) {
                    if (depth < MAX_DISK_DEPTH) queue.addLast(entry to depth + 1)
                    continue
                }
                if (!entry.isFile || entry.length() <= 0L) continue
                val modifiedAt = entry.lastModified()
                result.pushMap(
                    Arguments.createMap().apply {
                        putString("sourceId", entry.absolutePath)
                        putString("name", name)
                        putString("mimeType", resolveMime(null, name))
                        putDouble("fileSize", entry.length().toDouble())
                        putString("createdAt", Instant.ofEpochMilli(modifiedAt.coerceAtLeast(0L)).toString())
                        putDouble("modifiedAt", modifiedAt.toDouble())
                    },
                )
                count += 1
                if (count >= MAX_DISK_FILES) break
            }
        }
        return result
    }

    private fun resolveMime(declared: String?, name: String): String {
        if (declared != null && declared != "application/octet-stream") return declared
        val extension = name.substringAfterLast('.', "")
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.lowercase())
            ?: declared
            ?: "application/octet-stream"
    }

    private fun allFilesAccess(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()

    private fun granted(): Boolean {
        val permissions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            listOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
        } else {
            listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        // Either is enough to see something: a user who granted photos but not video should still get
        // their downloaded pictures rather than an unusable feature.
        return permissions.any {
            ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun availableDestination(directory: File, requestedName: String): File {
        val safeName = File(requestedName).name
        require(safeName.isNotEmpty()) { "This download is no longer available." }
        var destination = File(directory, safeName)
        val extension = destination.extension
        val stem = destination.nameWithoutExtension
        var suffix = 2
        while (destination.exists()) {
            val next = if (extension.isEmpty()) "$stem $suffix" else "$stem $suffix.$extension"
            destination = File(directory, next)
            suffix += 1
        }
        return destination
    }
}
