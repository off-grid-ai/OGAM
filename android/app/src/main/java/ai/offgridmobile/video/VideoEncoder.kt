package ai.offgridmobile.video

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.Closeable

/** Platform MP4 adapter. Diffusion and job state remain in the shared runtime. */
class VideoEncoder(path: String, private val width: Int, private val height: Int, private val fps: Int) : Closeable {
    private val codec = MediaCodec.createEncoderByType("video/avc")
    private val muxer = MediaMuxer(path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    private var track = -1
    private var started = false
    private var frame = 0
    private val info = MediaCodec.BufferInfo()
    init {
        try {
            val format = MediaFormat.createVideoFormat("video/avc", width, height).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
                setInteger(MediaFormat.KEY_BIT_RATE, width * height * fps * 2)
                setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            }
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
        } catch (error: Throwable) { codec.release(); muxer.release(); throw error }
    }
    fun append(rgb: ByteArray, channels: Int, cancelled: () -> Boolean) {
        require(channels >= 3 && rgb.size == width * height * channels)
        var index: Int
        val deadline = System.nanoTime() + 30_000_000_000L
        do {
            check(!cancelled()) { "Video generation stopped." }
            index = codec.dequeueInputBuffer(10_000)
            drain(false, cancelled)
            check(System.nanoTime() < deadline) { "Video encoder stalled." }
        } while (index < 0)
        val image = checkNotNull(codec.getInputImage(index)) { "Video encoder has no YUV input." }
        for (y in 0 until height) for (x in 0 until width) {
            val p = (y * width + x) * channels
            val r = rgb[p].toInt() and 255; val g = rgb[p + 1].toInt() and 255; val b = rgb[p + 2].toInt() and 255
            fun put(plane: Int, px: Int, py: Int, value: Int) {
                val target = image.planes[plane]
                target.buffer.put(py * target.rowStride + px * target.pixelStride, value.coerceIn(0, 255).toByte())
            }
            put(0, x, y, ((66 * r + 129 * g + 25 * b + 128) shr 8) + 16)
            if (x % 2 == 0 && y % 2 == 0) {
                put(1, x / 2, y / 2, ((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128)
                put(2, x / 2, y / 2, ((112 * r - 94 * g - 18 * b + 128) shr 8) + 128)
            }
        }
        image.close()
        codec.queueInputBuffer(index, 0, width * height * 3 / 2, frame++ * 1_000_000L / fps, 0)
        drain(false, cancelled)
    }
    fun finish(cancelled: () -> Boolean) {
        val deadline = System.nanoTime() + 30_000_000_000L
        var index: Int
        do {
            check(!cancelled() && System.nanoTime() < deadline) { "Video encoding stopped." }
            index = codec.dequeueInputBuffer(10_000); drain(false, cancelled)
        } while (index < 0)
        codec.queueInputBuffer(index, 0, 0, frame * 1_000_000L / fps, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
        drain(true, cancelled)
    }
    private fun drain(finish: Boolean, cancelled: () -> Boolean) {
        val deadline = System.nanoTime() + 30_000_000_000L
        while (true) {
            check(!cancelled() && System.nanoTime() < deadline) { "Video encoding stopped." }
            val index = codec.dequeueOutputBuffer(info, if (finish) 10_000 else 0)
            if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                check(!started); track = muxer.addTrack(codec.outputFormat); muxer.start(); started = true
            } else if (index >= 0) {
                val buffer = checkNotNull(codec.getOutputBuffer(index))
                if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                if (info.size > 0) { check(started); buffer.position(info.offset); buffer.limit(info.offset + info.size); muxer.writeSampleData(track, buffer, info) }
                val done = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                codec.releaseOutputBuffer(index, false)
                if (done) return
            } else if (!finish) return
        }
    }
    override fun close() {
        try { codec.stop() } finally {
            codec.release()
            try { if (started) muxer.stop() } finally { muxer.release() }
        }
    }
}
