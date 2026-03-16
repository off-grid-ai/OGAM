package ai.offgridmobile.pdf

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import io.legere.pdfiumandroid.PdfDocument
import io.legere.pdfiumandroid.PdfiumCore
import android.os.ParcelFileDescriptor
import java.io.File

class PDFExtractorModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "PDFExtractorModule"

    private fun extractPageText(doc: PdfDocument, pageIndex: Int, sb: StringBuilder) {
        val page = doc.openPage(pageIndex)
        val textPage = page.openTextPage()
        val charCount = textPage.textPageCountChars()
        if (charCount > 0) {
            val text = textPage.textPageGetText(0, charCount)
            if (text != null) sb.append(text).append("\n\n")
        }
        textPage.close()
        page.close()
    }

    private fun isPathAllowed(filePath: String): Boolean {
        val canonical = File(filePath).canonicalPath
        val allowedBasePaths = listOf(
            reactApplicationContext.filesDir.canonicalPath,
            reactApplicationContext.cacheDir.canonicalPath,
        ) + (reactApplicationContext.getExternalFilesDir(null)?.canonicalPath?.let { listOf(it) } ?: emptyList()) +
            (reactApplicationContext.externalCacheDir?.canonicalPath?.let { listOf(it) } ?: emptyList())

        return allowedBasePaths.any { canonical.startsWith(it) }
    }

    @ReactMethod
    fun extractText(filePath: String, maxChars: Double, promise: Promise) {
        Thread {
            try {
                if (!isPathAllowed(filePath)) {
                    promise.reject("PDF_ERROR", "Access denied: file path is outside allowed directories")
                    return@Thread
                }

                val file = File(filePath)
                if (!file.exists()) {
                    promise.reject("PDF_ERROR", "File not found: $filePath")
                    return@Thread
                }

                val limit = maxChars.toInt()
                val core = PdfiumCore(reactApplicationContext)
                val fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                val doc = core.newDocument(fd)
                val pageCount = doc.getPageCount()
                val sb = StringBuilder()

                for (i in 0 until pageCount) {
                    extractPageText(doc, i, sb)

                    if (sb.length >= limit) {
                        sb.setLength(limit)
                        sb.append("\n\n... [Extracted ${i + 1} of $pageCount pages]")
                        break
                    }
                }

                doc.close()
                fd.close()
                promise.resolve(sb.toString())
            } catch (e: Exception) {
                promise.reject("PDF_ERROR", "Failed to extract text: ${e.message}", e)
            }
        }.start()
    }
}
