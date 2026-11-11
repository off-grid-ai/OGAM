package ai.offgridmobile.atlastts

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Turns an audio or video file (anything Android can play: mp3, m4a, aac, ogg, opus, flac,
 * wav, mp4, mov, webm...) into a 16 kHz mono 16-bit WAV for transcription and speaker labels.
 * Decodes the first audio track with MediaExtractor + MediaCodec and streams it to disk, so
 * long files do not fill memory.
 */
object AudioDecoder {
    const val RATE = 16000

    /** Decodes `uri` into `out`. Returns the length in seconds. */
    fun decode(ctx: Context, uri: Uri, out: File, cancelled: () -> Boolean, onProgress: (Double) -> Unit): Double {
        val ex = MediaExtractor()
        var codec: MediaCodec? = null
        val wav = WavWriter(out)
        try {
            ex.setDataSource(ctx, uri, null)
            val track = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
                ?: throw IllegalArgumentException("This file has no sound to transcribe")
            ex.selectTrack(track)
            val fmt = ex.getTrackFormat(track)
            val durationUs = if (fmt.containsKey(MediaFormat.KEY_DURATION)) fmt.getLong(MediaFormat.KEY_DURATION) else 0L
            val c = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
            codec = c
            c.configure(fmt, null, null, 0)
            c.start()
            var pcm = PcmShape(fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE), fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT), false)
            var resampler = Resampler(pcm.rate, RATE)
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            while (true) {
                if (cancelled()) throw InterruptedException("cancelled")
                if (!inputDone) {
                    val i = c.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val n = ex.readSampleData(c.getInputBuffer(i)!!, 0)
                        if (n < 0) { c.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                        else { c.queueInputBuffer(i, 0, n, ex.sampleTime, 0); ex.advance() }
                    }
                }
                val o = c.dequeueOutputBuffer(info, 10_000)
                if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val f = c.outputFormat
                    val float = f.containsKey(MediaFormat.KEY_PCM_ENCODING) && f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                    pcm = PcmShape(f.getInteger(MediaFormat.KEY_SAMPLE_RATE), f.getInteger(MediaFormat.KEY_CHANNEL_COUNT), float)
                    resampler = Resampler(pcm.rate, RATE)
                } else if (o >= 0) {
                    val buf = c.getOutputBuffer(o)!!
                    buf.position(info.offset); buf.limit(info.offset + info.size)
                    wav.write(resampler.push(mono(buf.order(ByteOrder.LITTLE_ENDIAN), pcm)))
                    c.releaseOutputBuffer(o, false)
                    if (durationUs > 0) onProgress((info.presentationTimeUs.toDouble() / durationUs).coerceIn(0.0, 1.0))
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                }
            }
            if (wav.samples == 0L) throw IllegalStateException("No sound could be read from this file")
            return wav.samples.toDouble() / RATE
        } catch (e: Throwable) {
            wav.close(); out.delete()
            throw e
        } finally {
            wav.close()
            try { codec?.stop() } catch (_: Throwable) {}
            try { codec?.release() } catch (_: Throwable) {}
            ex.release()
        }
    }

    data class PcmShape(val rate: Int, val channels: Int, val float: Boolean)

    /** Decoded PCM (16-bit or float, interleaved) as mono floats in -1..1. */
    fun mono(buf: ByteBuffer, pcm: PcmShape): FloatArray {
        val ch = pcm.channels.coerceAtLeast(1)
        val frames = buf.remaining() / ((if (pcm.float) 4 else 2) * ch)
        return FloatArray(frames) {
            var sum = 0f
            repeat(ch) { sum += if (pcm.float) buf.float else buf.short / 32768f }
            sum / ch
        }
    }

    /** Mono floats to 16-bit little-endian PCM bytes. */
    fun toPcm16(x: FloatArray): ByteArray {
        val b = ByteBuffer.allocate(x.size * 2).order(ByteOrder.LITTLE_ENDIAN)
        for (v in x) b.putShort((v.coerceIn(-1f, 1f) * 32767f).toInt().toShort())
        return b.array()
    }

    /** The 44-byte header of a mono 16-bit WAV with `dataBytes` of samples. */
    fun wavHeader(dataBytes: Long, rate: Int = RATE): ByteArray {
        val b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()); b.putInt((36 + dataBytes).toInt()); b.put("WAVE".toByteArray())
        b.put("fmt ".toByteArray()); b.putInt(16); b.putShort(1); b.putShort(1)
        b.putInt(rate); b.putInt(rate * 2); b.putShort(2); b.putShort(16)
        b.put("data".toByteArray()); b.putInt(dataBytes.toInt())
        return b.array()
    }

    /** Streaming linear resampler: keeps its place between chunks, so chunk edges do not click. */
    class Resampler(private val from: Int, private val to: Int) {
        private var pos = 0.0
        private var prev = 0f
        private var started = false

        fun push(x: FloatArray): FloatArray {
            if (x.isEmpty()) return x
            if (from == to || from <= 0) return x
            // Sample k of the chunk is at index k + 1 of [prev, x...]; pos runs over that.
            val step = from.toDouble() / to
            val out = ArrayList<Float>((x.size * to / from) + 2)
            if (!started) { prev = x[0]; started = true; pos = 1.0 }
            while (pos < x.size) {
                val k = pos.toInt()
                val f = (pos - k).toFloat()
                val a = if (k == 0) prev else x[k - 1]
                val b = x[k]
                out.add(a * (1 - f) + b * f)
                pos += step
            }
            pos -= x.size
            prev = x[x.size - 1]
            return out.toFloatArray()
        }
    }

    private class WavWriter(file: File) {
        private val raf = RandomAccessFile(file, "rw").apply { setLength(0); write(wavHeader(0)) }
        var samples = 0L
            private set
        private var closed = false

        fun write(x: FloatArray) { if (x.isNotEmpty()) { raf.write(toPcm16(x)); samples += x.size } }

        fun close() {
            if (closed) return
            closed = true
            try { raf.seek(0); raf.write(wavHeader(samples * 2)) } finally { raf.close() }
        }
    }
}
