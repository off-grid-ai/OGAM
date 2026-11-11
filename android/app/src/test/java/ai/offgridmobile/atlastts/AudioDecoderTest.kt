package ai.offgridmobile.atlastts

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class AudioDecoderTest {
    @Test
    fun writesAMono16kHzWavHeader() {
        val h = ByteBuffer.wrap(AudioDecoder.wavHeader(32000)).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals("RIFF", String(AudioDecoder.wavHeader(32000).copyOfRange(0, 4)))
        assertEquals(36 + 32000, h.getInt(4))
        assertEquals(1, h.getShort(22).toInt())
        assertEquals(16000, h.getInt(24))
        assertEquals(16, h.getShort(34).toInt())
        assertEquals(32000, h.getInt(40))
    }

    @Test
    fun downmixesStereo16BitToMono() {
        val b = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
        b.putShort(16384); b.putShort(0); b.putShort(-16384); b.putShort(-16384)
        b.flip()
        val m = AudioDecoder.mono(b, AudioDecoder.PcmShape(44100, 2, false))
        assertArrayEquals(floatArrayOf(0.25f, -0.5f), m, 1e-4f)
    }

    @Test
    fun resamples48kTo16kAcrossChunksWithoutLosingTime() {
        val r = AudioDecoder.Resampler(48000, 16000)
        val total = (0 until 10).sumOf { r.push(FloatArray(4800) { 0.1f }).size }
        // One second of 48 kHz in ten chunks gives one second at 16 kHz.
        assertEquals(16000.0, total.toDouble(), 2.0)
    }

    @Test
    fun keepsAToneSmoothAtChunkEdges() {
        val r = AudioDecoder.Resampler(32000, 16000)
        val ramp = FloatArray(64) { it.toFloat() }
        val out = r.push(ramp.copyOfRange(0, 32)) + r.push(ramp.copyOfRange(32, 64))
        for (i in 1 until out.size) assertEquals(2f, out[i] - out[i - 1], 1e-4f)
    }
}
