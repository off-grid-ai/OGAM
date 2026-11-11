package ai.offgridmobile.atlastts

import java.io.File

/**
 * Downloads a model .zip (voices, speaker-label models) from Atlas's GitHub releases and
 * unpacks it while downloading into `<root>/<id>`. A zip holding one top folder is flattened.
 */
object ModelPack {
    fun download(url: String, root: File, id: String, isCancelled: () -> Boolean, progress: (Double) -> Unit): File {
        val tmp = File(root, "$id.part")
        try {
            tmp.deleteRecursively(); tmp.mkdirs()
            var conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            conn.connectTimeout = 30000; conn.readTimeout = 60000; conn.instanceFollowRedirects = true
            conn.setRequestProperty("User-Agent", "Atlas")
            var hops = 0
            while (conn.responseCode in 300..399 && hops++ < 5) {
                val loc = conn.getHeaderField("Location") ?: break
                conn.disconnect()
                conn = java.net.URL(conn.url, loc).openConnection() as java.net.HttpURLConnection
                conn.connectTimeout = 30000; conn.readTimeout = 60000; conn.setRequestProperty("User-Agent", "Atlas")
            }
            if (conn.responseCode >= 400) throw IllegalStateException("HTTP ${conn.responseCode}")
            val total = conn.contentLengthLong
            var read = 0L
            var last = 0L
            val counting = object : java.io.FilterInputStream(java.io.BufferedInputStream(conn.inputStream, 1 shl 16)) {
                override fun read(b: ByteArray, off: Int, len: Int): Int {
                    if (isCancelled()) throw java.io.InterruptedIOException("cancelled")
                    val n = super.read(b, off, len)
                    if (n > 0) {
                        read += n
                        val now = System.currentTimeMillis()
                        if (now - last > 500) { last = now; progress(if (total > 0) read.toDouble() / total else -1.0) }
                    }
                    return n
                }
            }
            java.util.zip.ZipInputStream(counting).use { zip ->
                val base = tmp.canonicalPath
                var e = zip.nextEntry
                while (e != null) {
                    val out = File(tmp, e.name)
                    if (!out.canonicalPath.startsWith(base + File.separator)) throw SecurityException("bad zip entry")
                    if (e.isDirectory) out.mkdirs() else { out.parentFile?.mkdirs(); java.io.FileOutputStream(out).use { zip.copyTo(it, 1 shl 16) } }
                    e = zip.nextEntry
                }
            }
            val kids = tmp.listFiles() ?: emptyArray()
            val src = if (kids.size == 1 && kids[0].isDirectory) kids[0] else tmp
            val dest = File(root, id)
            dest.deleteRecursively()
            if (!src.renameTo(dest)) throw IllegalStateException("Could not move the downloaded files")
            tmp.deleteRecursively()
            progress(1.0)
            return dest
        } catch (e: Throwable) {
            tmp.deleteRecursively()
            throw e
        }
    }
}
