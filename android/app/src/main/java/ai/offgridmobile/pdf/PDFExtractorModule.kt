package ai.offgridmobile.pdf

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.Arguments
import ai.offgridmobile.SafePromise
import io.legere.pdfiumandroid.PdfDocument
import io.legere.pdfiumandroid.PdfiumCore
import android.os.ParcelFileDescriptor
import java.io.File

class PDFExtractorModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val NAME = "PDFExtractorModule"
    }

    private fun safeReject(promise: Promise, code: String, message: String, throwable: Throwable? = null) =
        SafePromise(promise, NAME).reject(code, message, throwable)

    private fun safeResolve(promise: Promise, value: Any?) =
        SafePromise(promise, NAME).resolve(value)

    override fun getName(): String = NAME

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

    @ReactMethod
    fun extractText(filePath: String, maxChars: Double, promise: Promise) {
        Thread {
            try {
                val file = File(filePath)
                if (!file.exists()) {
                    safeReject(promise, "PDF_ERROR", "File not found: $filePath")
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
                safeResolve(promise, sb.toString())
            } catch (e: Exception) {
                safeReject(promise, "PDF_ERROR", "Failed to extract text: ${e.message}", e)
            }
        }.start()
    }

    /** How many pages the PDF has. */
    @ReactMethod
    fun pageCount(filePath: String, promise: Promise) {
        Thread {
            try {
                val file = File(filePath)
                if (!file.exists()) { safeReject(promise, "PDF_ERROR", "File not found: $filePath"); return@Thread }
                val core = PdfiumCore(reactApplicationContext)
                val fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                val doc = core.newDocument(fd)
                val count = doc.getPageCount()
                doc.close()
                fd.close()
                safeResolve(promise, count)
            } catch (e: Exception) {
                safeReject(promise, "PDF_ERROR", "Failed to read the page count: ${e.message}", e)
            }
        }.start()
    }

    /**
     * The text of `count` pages starting at the 0-based `start`, one string per page, in order (an empty string for a page with no
     * text, for example a scan). Keeps page boundaries, which extractText loses, so a finding can cite its page.
     */
    @ReactMethod
    fun extractPages(filePath: String, start: Double, count: Double, promise: Promise) {
        Thread {
            try {
                val file = File(filePath)
                if (!file.exists()) { safeReject(promise, "PDF_ERROR", "File not found: $filePath"); return@Thread }
                val core = PdfiumCore(reactApplicationContext)
                val fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                val doc = core.newDocument(fd)
                val total = doc.getPageCount()
                val from = start.toInt().coerceAtLeast(0)
                val to = (from + count.toInt()).coerceAtMost(total)
                val result = Arguments.createArray()
                for (i in from until to) {
                    val sb = StringBuilder()
                    extractPageText(doc, i, sb)
                    result.pushString(sb.toString().trimEnd())
                }
                doc.close()
                fd.close()
                safeResolve(promise, result)
            } catch (e: Exception) {
                safeReject(promise, "PDF_ERROR", "Failed to extract pages: ${e.message}", e)
            }
        }.start()
    }
}
