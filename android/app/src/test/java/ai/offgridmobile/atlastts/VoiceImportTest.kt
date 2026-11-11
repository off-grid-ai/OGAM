package ai.offgridmobile.atlastts

import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class VoiceImportTest {
    @get:Rule val tmp = TemporaryFolder()

    private val files = mapOf("v/model.onnx" to "m", "v/tokens.txt" to "t", "v/espeak-ng-data/x" to "e")

    private fun tarBz2(entries: Map<String, String>): ByteArray {
        val out = ByteArrayOutputStream()
        TarArchiveOutputStream(BZip2CompressorOutputStream(out)).use { t ->
            entries.forEach { (n, body) ->
                val e = TarArchiveEntry(n); e.size = body.length.toLong()
                t.putArchiveEntry(e); t.write(body.toByteArray()); t.closeArchiveEntry()
            }
        }
        return out.toByteArray()
    }

    private fun zip(entries: Map<String, String>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { z -> entries.forEach { (n, body) -> z.putNextEntry(ZipEntry(n)); z.write(body.toByteArray()); z.closeEntry() } }
        return out.toByteArray()
    }

    @Test
    fun idDropsTheArchiveExtension() {
        assertEquals("vits-piper-en_GB-northern_english_male-medium", VoiceImport.idFor("vits-piper-en_GB-northern_english_male-medium.tar.bz2"))
        assertEquals("kitten-nano-en", VoiceImport.idFor("kitten-nano-en.zip"))
        assertEquals("my_voice", VoiceImport.idFor("my voice.zip"))
    }

    @Test
    fun unpacksSherpaTarBz2AndZip() {
        for (bytes in listOf(tarBz2(files), zip(files))) {
            val dest = tmp.newFolder()
            VoiceImport.unpack(ByteArrayInputStream(bytes), dest)
            assertTrue(File(dest, "v/model.onnx").exists())
            assertNull(VoiceImport.problem(File(dest, "v")))
        }
    }

    @Test(expected = SecurityException::class)
    fun refusesPathsOutsideTheVoiceFolder() {
        VoiceImport.unpack(ByteArrayInputStream(zip(mapOf("../evil.txt" to "x"))), tmp.newFolder())
    }

    @Test
    fun explainsUnconvertedPiperVoices() {
        val dir = tmp.newFolder("piper")
        File(dir, "en_GB-alan-medium.onnx").writeText("m"); File(dir, "en_GB-alan-medium.onnx.json").writeText("{}")
        assertTrue(VoiceImport.problem(dir)!!.contains("not been converted"))
        assertTrue(VoiceImport.problem(tmp.newFolder("empty"))!!.contains("no voice model"))
    }
}
