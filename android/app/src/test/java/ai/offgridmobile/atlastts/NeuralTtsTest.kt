package ai.offgridmobile.atlastts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class NeuralTtsTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun voice(name: String, vararg files: String): File {
        val dir = tmp.newFolder(name)
        files.forEach { File(dir, it).writeText("x") }
        return dir
    }

    @Test
    fun kittenFolderIsDetected() {
        assertTrue(NeuralTts.isKitten(voice("kitten-nano-en", "model.fp16.onnx", "voices.bin", "tokens.txt")))
    }

    @Test
    fun kokoroFolderWithVoicesBinIsNotKitten() {
        assertFalse(NeuralTts.isKitten(voice("kokoro-en", "model.onnx", "voices.bin", "tokens.txt")))
    }

    @Test
    fun kittenNamedFolderWithoutVoicesIsNotKitten() {
        assertFalse(NeuralTts.isKitten(voice("kitten-broken", "model.fp16.onnx", "tokens.txt")))
    }

    private val v1 = listOf("lexicon-gb-en.txt", "lexicon-us-en.txt", "lexicon-zh.txt", "model.int8.onnx")

    @Test
    fun britishSpeakerUsesOnlyTheUkDictionary() {
        assertEquals(Pair(listOf("lexicon-gb-en.txt"), "en"), NeuralTts.kokoroDictionary(v1, "gb"))
    }

    @Test
    fun americanSpeakerUsesTheUsDictionary() {
        assertEquals(Pair(listOf("lexicon-us-en.txt"), "en-us"), NeuralTts.kokoroDictionary(v1, "us"))
        assertEquals(Pair(listOf("lexicon-us-en.txt"), "en-us"), NeuralTts.kokoroDictionary(v1, ""))
    }

    @Test
    fun singleAccentKokoroKeepsEveryLexicon() {
        assertEquals(Pair(listOf("lexicon-a.txt", "lexicon-b.txt"), ""), NeuralTts.kokoroDictionary(listOf("lexicon-b.txt", "lexicon-a.txt", "voices.bin"), "gb"))
    }

    @Test
    fun deeperVoiceKeepsThePace() {
        val (speed, rate) = NeuralTts.deepen(0.95f, 24000, 0.9f)
        assertEquals(0.95f / 0.9f, speed, 1e-4f)
        assertEquals(21600, rate)
        assertEquals(Pair(1f, 24000), NeuralTts.deepen(1f, 24000, 1f))
    }
}
