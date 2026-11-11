package ai.offgridmobile.atlastts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeechChunksTest {
    private val reply = "Sure, I can help with that. Here is the first thing to know about it. " +
        "And here is a second thing. Then a third, so you have the full picture of it."

    @Test
    fun aLongFirstPieceIsSplitAfterItsFirstSentence() {
        val parts = SpeechChunks.speechParts(reply, 380, firstMax = 60)
        assertEquals("Sure, I can help with that.", parts[0])
        assertEquals(2, parts.size)
        assertEquals(reply, parts.joinToString(" "))
    }

    @Test
    fun aShortFirstPieceIsLeftAlone() {
        assertEquals(listOf("Hello there. How are you?"), SpeechChunks.speechParts("Hello there. How are you?", 380))
    }

    @Test
    fun oneLongSentenceIsNotCutInTheMiddle() {
        val sentence = "word ".repeat(60).trim() + "."
        assertEquals(1, SpeechChunks.speechParts(sentence, 380, firstMax = 60).size)
    }

    @Test
    fun laterPiecesKeepTheirSize() {
        val text = (1..40).joinToString(" ") { "This is sentence number $it." }
        val parts = SpeechChunks.speechParts(text, 380, firstMax = 60)
        assertTrue(parts.all { it.length <= 380 })
        assertTrue(parts[0].length < parts[1].length)
    }
}
