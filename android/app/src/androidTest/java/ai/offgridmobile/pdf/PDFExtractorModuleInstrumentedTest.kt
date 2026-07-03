package ai.offgridmobile.pdf

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.pdf.PdfDocument as AndroidPdfDocument
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * On-device tests for PDFExtractorModule's OCR paths. These need real native
 * libs (PDFium rendering, ML Kit text recognition), so they run as
 * instrumented tests on an emulator/device via connectedDebugAndroidTest —
 * they cannot run under Robolectric.
 */
@RunWith(AndroidJUnit4::class)
class PDFExtractorModuleInstrumentedTest {

    private class AwaitablePromise : Promise {
        private val latch = CountDownLatch(1)
        var result: Any? = null
            private set
        var errorMessage: String? = null
            private set

        fun await(seconds: Long = 120): AwaitablePromise {
            assertTrue("Promise not settled within ${seconds}s", latch.await(seconds, TimeUnit.SECONDS))
            return this
        }

        private fun fail(code: String?, message: String?) {
            errorMessage = "${code ?: "?"}: ${message ?: "?"}"
            latch.countDown()
        }

        override fun resolve(value: Any?) {
            result = value
            latch.countDown()
        }

        override fun reject(code: String, message: String?) = fail(code, message)
        override fun reject(code: String, throwable: Throwable?) = fail(code, throwable?.message)
        override fun reject(code: String, message: String?, throwable: Throwable?) = fail(code, message)
        override fun reject(throwable: Throwable) = fail(null, throwable.message)
        override fun reject(throwable: Throwable, userInfo: WritableMap) = fail(null, throwable.message)
        override fun reject(code: String, userInfo: WritableMap) = fail(code, null)
        override fun reject(code: String, throwable: Throwable?, userInfo: WritableMap) = fail(code, throwable?.message)
        override fun reject(code: String, message: String?, userInfo: WritableMap) = fail(code, message)
        override fun reject(code: String?, message: String?, throwable: Throwable?, userInfo: WritableMap?) = fail(code, message)
        @Deprecated("Prefer passing a module-specific error code to JS. Using this method will pass the\n        error code EUNSPECIFIED", replaceWith = ReplaceWith("reject(code, message)"))
        override fun reject(message: String) = fail(null, message)
    }

    private fun newModule(): PDFExtractorModule {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        return PDFExtractorModule(ReactApplicationContext(ctx))
    }

    /** Draw text into a bitmap — the raster stand-in for a scanned page. */
    private fun makeTextBitmap(lines: List<String>): Bitmap {
        val bitmap = Bitmap.createBitmap(1224, 1584, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = 64f
        }
        var y = 240f
        for (line in lines) {
            canvas.drawText(line, 100f, y, paint)
            y += 110f
        }
        return bitmap
    }

    private val sampleLines = listOf(
        "The quick brown fox jumps",
        "over the lazy dog.",
        "Invoice total: 1234.56 EUR",
    )

    @Test
    fun recognizeImage_readsTextFromPng() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val bitmap = makeTextBitmap(sampleLines)
        val file = File(ctx.cacheDir, "ocr-test-image.png")
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }

        val promise = AwaitablePromise()
        newModule().recognizeImage(file.path, promise)
        promise.await()

        assertNull("recognizeImage rejected: ${promise.errorMessage}", promise.errorMessage)
        val text = promise.result as String
        assertTrue(
            "OCR output missing expected words. Got: $text",
            text.contains("quick", ignoreCase = true) && text.contains("1234"),
        )
    }

    @Test
    fun extractText_usesOcrFallbackForScannedPdf() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val bitmap = makeTextBitmap(sampleLines)

        // Build an image-only PDF (no text layer), like scanner output
        val pdfFile = File(ctx.cacheDir, "ocr-test-scanned.pdf")
        val pdf = AndroidPdfDocument()
        val page = pdf.startPage(AndroidPdfDocument.PageInfo.Builder(612, 792, 1).create())
        page.canvas.drawBitmap(bitmap, null, Rect(0, 0, 612, 792), null)
        pdf.finishPage(page)
        pdfFile.outputStream().use { pdf.writeTo(it) }
        pdf.close()

        val promise = AwaitablePromise()
        newModule().extractText(pdfFile.path, 50000.0, promise)
        promise.await()

        assertNull("extractText rejected: ${promise.errorMessage}", promise.errorMessage)
        val text = promise.result as String
        assertTrue(
            "Scanned PDF should yield OCR text. Got: $text",
            text.contains("quick", ignoreCase = true) && text.contains("1234"),
        )
    }

    @Test
    fun recognizeImage_rejectsForMissingFile() {
        val promise = AwaitablePromise()
        newModule().recognizeImage("/no/such/file.png", promise)
        promise.await(30)

        assertTrue(
            "Expected OCR_ERROR rejection, got result=${promise.result}",
            promise.errorMessage?.contains("OCR_ERROR") == true,
        )
    }
}
