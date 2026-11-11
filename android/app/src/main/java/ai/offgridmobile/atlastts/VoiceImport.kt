package ai.offgridmobile.atlastts

import org.apache.commons.compress.archivers.ArchiveInputStream
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.archivers.zip.ZipArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream

/** Unpacking and checking voice files the user imports (sherpa-onnx voice packages). */
object VoiceImport {
    /** Folder id for an imported file: its name without the archive extension, safe for a path. */
    fun idFor(name: String): String {
        val base = name.substringAfterLast('/')
            .replace(Regex("\\.(tar\\.bz2|tar\\.gz|tgz|tbz2?|tar|zip)$", RegexOption.IGNORE_CASE), "")
            .replace(Regex("[^A-Za-z0-9._-]"), "_").trim('.', '_')
        return base.ifEmpty { "imported-voice" }.take(80)
    }

    /** Unpacks a .zip, .tar, .tar.bz2 or .tar.gz stream into `dest`, refusing paths that escape it. */
    fun unpack(raw: InputStream, dest: File) {
        val input = BufferedInputStream(raw, 1 shl 16)
        input.mark(4)
        val head = ByteArray(3).also { input.read(it) }
        input.reset()
        val archive: ArchiveInputStream<*> = when {
            head[0] == 'P'.code.toByte() && head[1] == 'K'.code.toByte() -> ZipArchiveInputStream(input)
            head[0] == 'B'.code.toByte() && head[1] == 'Z'.code.toByte() && head[2] == 'h'.code.toByte() ->
                TarArchiveInputStream(BZip2CompressorInputStream(input))
            head[0] == 0x1f.toByte() && head[1] == 0x8b.toByte() -> TarArchiveInputStream(GzipCompressorInputStream(input))
            else -> TarArchiveInputStream(input)
        }
        val base = dest.canonicalPath + File.separator
        archive.use { a ->
            var e = a.nextEntry
            var count = 0
            while (e != null) {
                if (++count > 20000) throw IllegalArgumentException("This file has too many entries to be a voice")
                val out = File(dest, e.name)
                if (!out.canonicalPath.startsWith(base) && out.canonicalPath != dest.canonicalPath) throw SecurityException("Bad file path in the archive")
                if (e.isDirectory) out.mkdirs()
                else if (a.canReadEntryData(e)) { out.parentFile?.mkdirs(); FileOutputStream(out).use { a.copyTo(it, 1 shl 16) } }
                e = a.nextEntry
            }
        }
    }

    /** Why a folder is not a voice Atlas can play, or null when it is. */
    fun problem(dir: File): String? {
        val names = dir.listFiles()?.map { it.name } ?: emptyList()
        if (names.none { it.endsWith(".onnx") }) return "This file has no voice model (.onnx). Atlas plays sherpa-onnx Piper, Kokoro and KittenTTS voices."
        if ("tokens.txt" !in names) {
            return if (names.any { it.endsWith(".onnx.json") })
                "This Piper voice has not been converted for sherpa-onnx. Download the vits-piper-... version from the sherpa-onnx tts-models release instead."
            else "This voice is missing tokens.txt, so Atlas cannot read it."
        }
        return null
    }
}
