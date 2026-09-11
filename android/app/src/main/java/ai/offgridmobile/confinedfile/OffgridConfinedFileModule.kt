package ai.offgridmobile.confinedfile

import android.os.Build
import android.system.Os
import android.system.OsConstants
import androidx.annotation.RequiresApi
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.nio.file.DirectoryStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.NoSuchFileException
import java.nio.file.OpenOption
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.SecureDirectoryStream
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.BasicFileAttributeView
import java.nio.file.attribute.BasicFileAttributes
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import org.json.JSONObject

class OffgridConfinedFileModule(
    private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
    /**
     * Every public mutation is synchronized on this module instance. The secure relative handles
     * reject detected symlink/path substitution, while Android's private files/cache roots exclude
     * other app UIDs. Rooted or malicious same-UID mutation after the final file-key check is
     * outside the supported boundary because Java NIO has no conditional unlink-by-file-key.
     */
    private companion object {
        val OPERATION_ID = Regex("[A-Za-z0-9._:-]{1,256}")
        const val RECEIPTS = "offgrid_confined_file_receipts"
    }

    override fun getName(): String = "OffgridConfinedFile"

    private data class MoveInput(
        val root: String,
        val source: String,
        val destination: String,
        val operationId: String,
    )

    @ReactMethod
    @Synchronized
    fun deleteConfinedRegularFile(input: ReadableMap, promise: Promise) {
        val values = try {
            Triple(
                input.getString("root"),
                input.getString("expectedPath"),
                input.getString("operationId"),
            )
        } catch (_: Exception) {
            promise.resolve(refused("INVALID_INPUT", "The confined-file request is malformed."))
            return
        }
        val (rootToken, expectedPath, operationId) = values
        if (rootToken == null || expectedPath == null || operationId == null) {
            promise.resolve(refused("INVALID_INPUT", "A root, exact path, and operation ID are required."))
            return
        }
        if (!OPERATION_ID.matches(operationId)) {
            promise.resolve(refused("INVALID_OPERATION_ID", "The operation ID is not stable."))
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            promise.resolve(refused("UNSUPPORTED_SEMANTICS", "Secure no-follow deletion is unavailable on this Android version."))
            return
        }

        try {
            promise.resolve(delete(rootToken, expectedPath, operationId))
        } catch (_: AtomicMoveNotSupportedException) {
            promise.resolve(refused("UNSUPPORTED_SEMANTICS", "The storage provider cannot quarantine atomically."))
        } catch (_: UnsupportedOperationException) {
            promise.resolve(refused("UNSUPPORTED_SEMANTICS", "The storage provider cannot quarantine securely."))
        } catch (_: NoSuchFileException) {
            promise.resolve(outcome("already_missing"))
        } catch (error: Exception) {
            promise.resolve(refused("DELETE_FAILED", error.message ?: "Confined file deletion failed."))
        }
    }

    @ReactMethod
    @Synchronized
    fun moveConfinedRegularFile(input: ReadableMap, promise: Promise) =
        moveConfined(input, promise, restoring = false)

    @ReactMethod
    @Synchronized
    fun restoreConfinedRegularFile(input: ReadableMap, promise: Promise) =
        moveConfined(input, promise, restoring = true)

    /** Upgrade only: adopt bytes already quarantined by a durable pre-receipt release journal. */
    @ReactMethod
    @Synchronized
    fun adoptLegacyConfinedQuarantineReceipt(input: ReadableMap, promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            promise.resolve(refused("UNSUPPORTED_SEMANTICS", "Secure quarantine adoption is unavailable."))
            return
        }
        val rootToken: String
        val originalPath: String
        val quarantinePath: String
        val operationId: String
        val expectedSizeValue: Double
        val expectedSha256: String
        try {
            rootToken = input.getString("root") ?: ""
            originalPath = input.getString("expectedOriginalPath") ?: ""
            quarantinePath = input.getString("expectedQuarantinePath") ?: ""
            operationId = input.getString("operationId") ?: ""
            expectedSizeValue = input.getDouble("expectedSize")
            expectedSha256 = input.getString("expectedSha256") ?: ""
        } catch (_: Exception) {
            promise.resolve(refused("INVALID_ADOPTION_AUTHORITY", "The durable journal authority is malformed."))
            return
        }
        val expectedSize = expectedSizeValue.toLong()
        if (
            rootToken != "shared_files" ||
            !OPERATION_ID.matches(operationId) ||
            expectedSize <= 0 ||
            expectedSizeValue != expectedSize.toDouble() ||
            !Regex("[0-9a-f]{64}").matches(expectedSha256) ||
            quarantinePath != quarantinePath(originalPath, operationId)
        ) {
            promise.resolve(refused("INVALID_ADOPTION_AUTHORITY", "The durable journal authority is invalid."))
            return
        }
        try {
            promise.resolve(
                adoptLegacyReceipt(
                    rootToken,
                    originalPath,
                    quarantinePath,
                    operationId,
                    expectedSize,
                    expectedSha256,
                ),
            )
        } catch (_: UnsupportedOperationException) {
            promise.resolve(refused("UNSUPPORTED_SEMANTICS", "The quarantine cannot be verified securely."))
        } catch (error: Exception) {
            promise.resolve(refused("ADOPTION_FAILED", error.message ?: "Quarantine adoption failed."))
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun adoptLegacyReceipt(
        rootToken: String,
        originalPath: String,
        expectedQuarantinePath: String,
        operationId: String,
        expectedSize: Long,
        expectedSha256: String,
    ): ReadableMap {
        val rootPath = checkedRoot(rootToken)
            ?: return refused("UNSAFE_ROOT", "The shared-files root is not a no-follow directory.")
        val original = checkedRelative(rootPath, originalPath)
            ?: return refused("INVALID_PATH", "The journal original path is not confined.")
        val quarantine = checkedRelative(rootPath, expectedQuarantinePath)
            ?: return refused("INVALID_QUARANTINE", "The journal quarantine path is not confined.")
        if (original.parent != quarantine.parent) {
            return refused("INVALID_QUARANTINE", "The journal quarantine is not a sibling path.")
        }
        val opened = mutableListOf<DirectoryStream<Path>>()
        try {
            val parent = openParent(rootPath, quarantine, opened)
                ?: return refused("UNSUPPORTED_SEMANTICS", "The quarantine has no secure directory handle.")
            if (attributes(parent, original.fileName) != null) {
                return refused("SOURCE_PRESENT", "The original path still exists; adoption is ambiguous.")
            }
            val before = attributes(parent, quarantine.fileName)
            val identity = regularFileIdentity(before)
                ?: return refused("UNSAFE_QUARANTINE", "The quarantine is not a stable regular file.")
            val options = setOf<OpenOption>(StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)
            val digest = MessageDigest.getInstance("SHA-256")
            var size = 0L
            parent.newByteChannel(quarantine.fileName, options).use { channel ->
                val buffer = ByteBuffer.allocate(64 * 1024)
                while (true) {
                    val count = channel.read(buffer)
                    if (count < 0) break
                    if (count == 0) continue
                    size += count
                    buffer.flip()
                    digest.update(buffer)
                    buffer.clear()
                }
            }
            val sha256 = digest.digest().joinToString("") { byte ->
                "%02x".format(byte.toInt() and 0xff)
            }
            if (size != expectedSize || sha256 != expectedSha256) {
                return refused("BYTE_EVIDENCE_MISMATCH", "The quarantine does not match durable journal bytes.")
            }
            if (regularFileIdentity(attributes(parent, quarantine.fileName)) != identity) {
                return refused("PATH_CHANGED", "The quarantine changed during anchored verification.")
            }
            val key = receiptKey(rootToken, expectedQuarantinePath, operationId)
            val receipt = JSONObject()
                .put("version", 1)
                .put("root", rootToken)
                .put("originalPath", originalPath)
                .put("quarantinePath", expectedQuarantinePath)
                .put("operationId", operationId)
                .put("expectedSize", expectedSize)
                .put("expectedSha256", expectedSha256)
                .put("fileKey", identity.toString())
                .toString()
            return when (persistAdoptionReceipt(key, receipt, identity)) {
                "adopted" -> outcome("adopted")
                "already_adopted" -> outcome("already_adopted")
                "conflict" -> refused("RECEIPT_CONFLICT", "Another identity owns this quarantine receipt.")
                else -> refused("RECEIPT_FAILED", "The adopted quarantine receipt was not durable.")
            }
        } finally {
            for (stream in opened.asReversed()) stream.close()
        }
    }

    private fun moveConfined(input: ReadableMap, promise: Promise, restoring: Boolean) {
        val values = try {
            MoveInput(
                root = input.getString("root") ?: "",
                source = input.getString("expectedSourcePath") ?: "",
                destination = input.getString("expectedDestinationPath") ?: "",
                operationId = input.getString("operationId") ?: "",
            )
        } catch (_: Exception) {
            promise.resolve(refused("INVALID_INPUT", "The confined-move request is malformed."))
            return
        }
        if (values.root != "shared_files") {
            promise.resolve(refused("INVALID_ROOT", "Confined movement requires the shared-files root."))
            return
        }
        if (!OPERATION_ID.matches(values.operationId)) {
            promise.resolve(refused("INVALID_OPERATION_ID", "The operation ID is not stable."))
            return
        }
        if (values.source == values.destination) {
            promise.resolve(refused("INVALID_PATH", "The source and destination must be different."))
            return
        }
        val quarantine = if (restoring) values.source else values.destination
        val original = if (restoring) values.destination else values.source
        if (quarantine != quarantinePath(original, values.operationId)) {
            promise.resolve(refused("INVALID_QUARANTINE", "The quarantine path does not match its operation."))
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            promise.resolve(refused("UNSUPPORTED_SEMANTICS", "Secure atomic movement is unavailable on this Android version."))
            return
        }
        try {
            promise.resolve(move(values, restoring))
        } catch (_: AtomicMoveNotSupportedException) {
            promise.resolve(refused("UNSUPPORTED_SEMANTICS", "The storage provider cannot make an atomic confined move."))
        } catch (_: UnsupportedOperationException) {
            promise.resolve(refused("UNSUPPORTED_SEMANTICS", "The storage provider cannot make a secure confined move."))
        } catch (error: Exception) {
            promise.resolve(refused("MOVE_FAILED", error.message ?: "Confined file movement failed."))
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun delete(rootToken: String, expectedPath: String, operationId: String): ReadableMap {
        val rootPath = checkedRoot(rootToken)
            ?: return refused("UNSAFE_ROOT", "The selected app-owned root is not a no-follow directory.")
        val requested = checkedRelative(rootPath, expectedPath)
            ?: return refused("INVALID_PATH", "The expected path is not an exact confined path.")
        val suffix = quarantineSuffix(operationId)
        val suppliedQuarantine = expectedPath.endsWith(suffix) &&
            checkedRelative(rootPath, expectedPath.removeSuffix(suffix)) != null
        val original = if (suppliedQuarantine) {
            checkedRelative(rootPath, expectedPath.removeSuffix(suffix))
        } else {
            requested
        } ?: return refused("INVALID_QUARANTINE", "The quarantine original is not confined.")
        val quarantinePath = if (suppliedQuarantine) expectedPath else "$expectedPath$suffix"
        val quarantine = checkedRelative(rootPath, quarantinePath)
            ?: return refused("INVALID_QUARANTINE", "The operation quarantine is not confined.")
        val receiptKey = receiptKey(rootToken, quarantinePath, operationId)
        val opened = mutableListOf<DirectoryStream<Path>>()
        try {
            val parent = openParent(rootPath, requested, opened)
                ?: return refused("UNSUPPORTED_SEMANTICS", "The path has no secure directory handle.")
            val requestedName = requested.fileName
            val quarantineName = quarantine.fileName
            if (requested.parent != quarantine.parent) {
                return refused("INVALID_QUARANTINE", "The operation quarantine is not a sibling path.")
            }
            val sourceName = if (suppliedQuarantine) quarantineName else requestedName
            val source = attributes(parent, sourceName)
            if (source == null) {
                if (suppliedQuarantine && attributes(parent, original.fileName) != null) {
                    return refused("SOURCE_PRESENT", "The quarantine is absent while its original still exists.")
                }
                val replay = if (suppliedQuarantine) null else attributes(parent, quarantineName)
                if (replay == null) {
                    if (!clearReceipt(receiptKey)) {
                        return refused("RECEIPT_FAILED", "The absent quarantine identity was not cleared.")
                    }
                    return outcome("already_missing")
                }
                return deleteVerifiedQuarantine(parent, quarantineName, replay, receiptKey)
            }
            val identity = regularFileIdentity(source)
                ?: return refused("NOT_REGULAR_FILE", "The deletion source is not a stable regular file.")
            if (!suppliedQuarantine) {
                if (attributes(parent, quarantineName) != null) {
                    return refused("QUARANTINE_EXISTS", "The exclusive operation quarantine already exists.")
                }
                if (regularFileIdentity(attributes(parent, sourceName)) != identity) {
                    return refused("PATH_CHANGED", "The deletion source changed during validation.")
                }
                if (!saveReceipt(receiptKey, identity)) {
                    return refused("RECEIPT_FAILED", "The operation quarantine identity was not persisted.")
                }
                parent.move(sourceName, parent, quarantineName)
                if (attributes(parent, sourceName) != null) {
                    return refused("PATH_CHANGED", "The deletion source remained after quarantine movement.")
                }
            }
            val quarantined = attributes(parent, quarantineName)
                ?: return refused("PATH_CHANGED", "The operation quarantine is missing.")
            if (regularFileIdentity(quarantined) != identity) {
                restoreUnexpectedQuarantine(parent, quarantineName, requestedName, receiptKey)
                return refused("PATH_CHANGED", "The operation quarantine has the wrong file identity.")
            }
            return deleteVerifiedQuarantine(parent, quarantineName, quarantined, receiptKey)
        } finally {
            for (stream in opened.asReversed()) stream.close()
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun deleteVerifiedQuarantine(
        parent: SecureDirectoryStream<Path>,
        name: Path,
        first: BasicFileAttributes,
        receiptKey: String,
    ): ReadableMap {
        val identity = regularFileIdentity(first)
            ?: return refused("UNSAFE_QUARANTINE", "The operation quarantine is not a stable regular file.")
        if (!receiptMatches(receiptKey, readReceipt(receiptKey), identity)) {
            return refused("UNPROVEN_QUARANTINE", "The operation quarantine has no matching durable identity.")
        }
        if (regularFileIdentity(attributes(parent, name)) != identity) {
            return refused("PATH_CHANGED", "The operation quarantine changed during validation.")
        }
        // All supported app-internal writers are excluded by the module lock. SecureDirectoryStream
        // has no atomic "delete only if fileKey" operation, so the check above is the final fence.
        parent.deleteFile(name)
        if (attributes(parent, name) != null) {
            return refused("DELETE_FAILED", "The operation quarantine remains after deletion.")
        }
        if (!clearReceipt(receiptKey)) {
            return refused("RECEIPT_FAILED", "The settled quarantine identity was not cleared.")
        }
        return outcome("deleted")
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun move(input: MoveInput, restoring: Boolean): ReadableMap {
        val rootPath = checkedRoot("shared_files")
            ?: return refused("UNSAFE_ROOT", "The shared-files root is not a no-follow directory.")
        val source = checkedRelative(rootPath, input.source)
            ?: return refused("INVALID_PATH", "The source is not an exact confined path.")
        val destination = checkedRelative(rootPath, input.destination)
            ?: return refused("INVALID_PATH", "The destination is not an exact confined path.")
        val opened = mutableListOf<DirectoryStream<Path>>()
        try {
            val sourceParent = openParent(rootPath, source, opened)
                ?: return refused("UNSUPPORTED_SEMANTICS", "The source has no secure directory handle.")
            val destinationParent = openParent(rootPath, destination, opened)
                ?: return refused("UNSUPPORTED_SEMANTICS", "The destination has no secure directory handle.")
            val sourceName = source.fileName
            val destinationName = destination.fileName
            val sourceAttributes = attributes(sourceParent, sourceName)
            val destinationAttributes = attributes(destinationParent, destinationName)
            val quarantinePath = if (restoring) input.source else input.destination
            val receiptKey = receiptKey(input.root, quarantinePath, input.operationId)
            if (sourceAttributes == null) {
                return alreadyMoved(
                    destinationParent,
                    destinationName,
                    destinationAttributes,
                    receiptKey,
                    restoring,
                )
            }
            val sourceIdentity = regularFileIdentity(sourceAttributes)
                ?: return refused("UNSAFE_SOURCE", "The source is not a stable regular file.")
            if (destinationAttributes != null) {
                return refused("DESTINATION_EXISTS", "The exact destination already exists while the source remains.")
            }
            val verifiedSource = attributes(sourceParent, sourceName)
            if (regularFileIdentity(verifiedSource) != sourceIdentity) {
                return refused("PATH_CHANGED", "The source changed during validation.")
            }
            if (!restoring && !saveReceipt(receiptKey, sourceIdentity)) {
                return refused("RECEIPT_FAILED", "The quarantine identity was not persisted.")
            }
            if (restoring && !receiptMatches(receiptKey, readReceipt(receiptKey), sourceIdentity)) {
                return refused("UNPROVEN_QUARANTINE", "The quarantine has no matching durable identity.")
            }
            sourceParent.move(sourceName, destinationParent, destinationName)
            val movedIdentity = regularFileIdentity(attributes(destinationParent, destinationName))
            if (attributes(sourceParent, sourceName) != null || movedIdentity != sourceIdentity) {
                return refused("PATH_CHANGED", "The moved file identity did not match the admitted source.")
            }
            if (restoring && !clearReceipt(receiptKey)) {
                return refused("RECEIPT_FAILED", "The restored quarantine identity was not cleared.")
            }
            return outcome("moved")
        } finally {
            for (stream in opened.asReversed()) stream.close()
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun checkedRoot(token: String): Path? {
        val path = root(token)?.toPath()?.toAbsolutePath()?.normalize() ?: return null
        val attributes = Files.readAttributes(path, BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
        return if (!attributes.isSymbolicLink && attributes.isDirectory) path else null
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun checkedRelative(root: Path, value: String): Path? {
        val path = Paths.get(value)
        if (!path.isAbsolute || path.normalize() != path || path.toString() != value) return null
        if (!path.startsWith(root) || path == root) return null
        return root.relativize(path)
    }

    private fun quarantineSuffix(operationId: String): String =
        ".offgrid-delete-${operationId.replace(":", "%3A")}"

    private fun quarantinePath(original: String, operationId: String): String =
        "$original${quarantineSuffix(operationId)}"

    @RequiresApi(Build.VERSION_CODES.O)
    private fun openParent(
        root: Path,
        relative: Path,
        opened: MutableList<DirectoryStream<Path>>,
    ): SecureDirectoryStream<Path>? {
        val rootStream = Files.newDirectoryStream(root)
        opened += rootStream
        var parent = rootStream as? SecureDirectoryStream<Path> ?: return null
        for (index in 0 until relative.nameCount - 1) {
            val name = relative.getName(index)
            val attributes = attributes(parent, name) ?: throw NoSuchFileException(name.toString())
            if (attributes.isSymbolicLink || !attributes.isDirectory) {
                throw IllegalStateException("A confined path parent is unsafe.")
            }
            val child = parent.newDirectoryStream(name, LinkOption.NOFOLLOW_LINKS)
            opened += child
            parent = child
        }
        return parent
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun attributes(parent: SecureDirectoryStream<Path>, name: Path): BasicFileAttributes? =
        try {
            parent.getFileAttributeView(
                name,
                BasicFileAttributeView::class.java,
                LinkOption.NOFOLLOW_LINKS,
            ).readAttributes()
        } catch (_: NoSuchFileException) {
            null
        }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun regularFileIdentity(attributes: BasicFileAttributes?): Any? =
        attributes?.takeIf { it.isRegularFile && !it.isSymbolicLink }?.fileKey()

    @RequiresApi(Build.VERSION_CODES.O)
    private fun alreadyMoved(
        parent: SecureDirectoryStream<Path>,
        name: Path,
        destination: BasicFileAttributes?,
        receiptKey: String,
        restoring: Boolean,
    ): ReadableMap {
        if (destination == null) {
            return refused("SOURCE_MISSING", "Neither the source nor the exact destination exists.")
        }
        val identity = regularFileIdentity(destination)
        return if (
            identity != null &&
            regularFileIdentity(attributes(parent, name)) == identity &&
            receiptMatches(receiptKey, readReceipt(receiptKey), identity)
        ) {
            if (restoring && !clearReceipt(receiptKey)) {
                refused("RECEIPT_FAILED", "The restored quarantine identity was not cleared.")
            } else {
                outcome("already_moved")
            }
        } else {
            refused("UNSAFE_DESTINATION", "The existing destination is not a stable regular file.")
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun restoreUnexpectedQuarantine(
        parent: SecureDirectoryStream<Path>,
        quarantine: Path,
        original: Path,
        receiptKey: String,
    ) {
        if (attributes(parent, original) == null && attributes(parent, quarantine) != null) {
            parent.move(quarantine, parent, original)
            if (attributes(parent, quarantine) == null) clearReceipt(receiptKey)
        }
    }

    private fun receiptKey(root: String, quarantine: String, operationId: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest("$root\u0000$operationId\u0000$quarantine".toByteArray(Charsets.UTF_8))
            .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

    private fun readReceipt(key: String): String? =
        context.getSharedPreferences(RECEIPTS, 0).getString(key, null)

    @Synchronized
    private fun saveReceipt(key: String, identity: Any): Boolean {
        val existing = readReceipt(key)
        if (existing != null) return receiptMatches(key, existing, identity)
        return saveReceiptValue(key, identity.toString()) &&
            readReceipt(key) == identity.toString() && syncReceiptStore()
    }

    private fun saveReceiptValue(key: String, value: String): Boolean =
        context.getSharedPreferences(RECEIPTS, 0).edit().putString(key, value).commit()

    @Synchronized
    private fun persistAdoptionReceipt(key: String, receipt: String, identity: Any): String {
        val existing = readReceipt(key)
        if (existing != null) {
            val matches = existing == receipt ||
                (!existing.startsWith("{") && existing == identity.toString())
            return if (!matches) "conflict"
            else if (syncReceiptStore()) "already_adopted"
            else "failed"
        }
        return if (
            saveReceiptValue(key, receipt) &&
            readReceipt(key) == receipt &&
            syncReceiptStore()
        ) "adopted" else "failed"
    }

    private fun receiptMatches(key: String, value: String?, identity: Any): Boolean {
        if (value == null) return false
        if (!value.startsWith("{")) return value == identity.toString()
        return try {
            val receipt = JSONObject(value)
            val root = receipt.getString("root")
            val original = receipt.getString("originalPath")
            val quarantine = receipt.getString("quarantinePath")
            val operationId = receipt.getString("operationId")
            receipt.getInt("version") == 1 &&
                receipt.getString("fileKey") == identity.toString() &&
                receipt.getLong("expectedSize") > 0 &&
                Regex("[0-9a-f]{64}").matches(receipt.getString("expectedSha256")) &&
                quarantine == quarantinePath(original, operationId) &&
                receiptKey(root, quarantine, operationId) == key
        } catch (_: Exception) {
            false
        }
    }

    private fun syncReceiptStore(): Boolean = try {
        val directory = File(context.applicationInfo.dataDir, "shared_prefs")
        val receiptFile = File(directory, "$RECEIPTS.xml")
        FileInputStream(receiptFile).use { it.fd.sync() }
        val directoryFD = Os.open(directory.path, OsConstants.O_RDONLY, 0)
        try {
            Os.fsync(directoryFD)
        } finally {
            Os.close(directoryFD)
        }
        true
    } catch (_: Exception) {
        false
    }

    private fun clearReceipt(key: String): Boolean =
        context.getSharedPreferences(RECEIPTS, 0).edit().remove(key).commit()

    // No external/shared storage is accepted. These roots are private to this application UID.
    private fun root(token: String) = when (token) {
        "documents" -> context.filesDir
        "cache", "temporary" -> context.cacheDir
        "shared_files" -> context.filesDir.resolve("shared_files")
        else -> null
    }

    private fun outcome(status: String) = Arguments.createMap().apply { putString("status", status) }

    private fun refused(code: String, message: String) = Arguments.createMap().apply {
        putString("status", "refused")
        putString("code", code)
        putString("message", message)
    }
}
