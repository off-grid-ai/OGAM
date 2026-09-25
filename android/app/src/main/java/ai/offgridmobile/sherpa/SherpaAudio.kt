package ai.offgridmobile.sherpa

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Minimal WAV → mono 16 kHz FloatArray reader for the on-device sherpa path. sherpa-onnx wants
 * normalized float samples at 16 kHz; the recorder already writes 16 kHz mono, but we handle
 * PCM16 / PCM32 / IEEE-float and stereo + a linear resample defensively so an odd clip never crashes
 * diarization. Kept dependency-free (no MediaExtractor) so it works the same on every device.
 */
object SherpaAudio {
  private const val TARGET_SR = 16000

  fun readMono16k(path: String): FloatArray {
    val clean = if (path.startsWith("file://")) path.substring(7) else path
    val bytes = File(clean).readBytes()
    if (bytes.size < 44 || String(bytes, 0, 4, Charsets.US_ASCII) != "RIFF") {
      throw IllegalArgumentException("not a RIFF/WAV file: $clean")
    }
    val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)

    var sampleRate = TARGET_SR
    var channels = 1
    var bits = 16
    var format = 1 // 1 = PCM, 3 = IEEE float
    var dataOff = -1
    var dataLen = 0

    var off = 12
    while (off + 8 <= bytes.size) {
      val id = String(bytes, off, 4, Charsets.US_ASCII)
      val sz = buf.getInt(off + 4)
      if (id == "fmt ") {
        format = buf.getShort(off + 8).toInt() and 0xffff
        channels = (buf.getShort(off + 10).toInt() and 0xffff).coerceAtLeast(1)
        sampleRate = buf.getInt(off + 12).let { if (it > 0) it else TARGET_SR }
        bits = (buf.getShort(off + 22).toInt() and 0xffff).let { if (it > 0) it else 16 }
      } else if (id == "data") {
        dataOff = off + 8
        dataLen = minOf(sz, bytes.size - dataOff)
        break
      }
      off += 8 + sz + (sz and 1)
    }
    if (dataOff < 0) throw IllegalArgumentException("no data chunk in WAV: $clean")

    val mono: FloatArray = when {
      format == 3 && bits == 32 -> {
        val n = dataLen / 4 / channels
        FloatArray(n) { i ->
          var acc = 0f
          for (c in 0 until channels) acc += buf.getFloat(dataOff + (i * channels + c) * 4)
          acc / channels
        }
      }
      bits == 16 -> {
        val n = dataLen / 2 / channels
        FloatArray(n) { i ->
          var acc = 0f
          for (c in 0 until channels) acc += buf.getShort(dataOff + (i * channels + c) * 2).toInt() / 32768f
          acc / channels
        }
      }
      bits == 32 -> {
        val n = dataLen / 4 / channels
        FloatArray(n) { i ->
          var acc = 0f
          for (c in 0 until channels) acc += buf.getInt(dataOff + (i * channels + c) * 4) / 2147483648f
          acc / channels
        }
      }
      else -> throw IllegalArgumentException("unsupported WAV ($bits-bit, format $format)")
    }

    return if (sampleRate == TARGET_SR) mono else resampleLinear(mono, sampleRate, TARGET_SR)
  }

  private fun resampleLinear(input: FloatArray, fromSr: Int, toSr: Int): FloatArray {
    val ratio = toSr.toDouble() / fromSr
    val outLen = (input.size * ratio).toInt()
    return FloatArray(outLen) { i ->
      val srcPos = i / ratio
      val i0 = srcPos.toInt()
      val i1 = minOf(i0 + 1, input.size - 1)
      val frac = (srcPos - i0).toFloat()
      input[i0] * (1 - frac) + input[i1] * frac
    }
  }
}
