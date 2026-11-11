package ai.offgridmobile.atlasdevice

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Full-screen camera that reads a QR code on the phone (ML Kit's bundled model: no internet,
 * no Google Play download) and returns the first code that starts with the `prefix` extra.
 * Codes that do not match (any other QR code) are ignored, so a stray code cannot pair.
 */
class AtlasQrScanActivity : ComponentActivity() {
    private val done = AtomicBoolean(false)
    private val analysisThread = Executors.newSingleThreadExecutor()
    private val scanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefix = intent.getStringExtra(EXTRA_PREFIX) ?: ""
        val preview = PreviewView(this)
        val hint = TextView(this).apply {
            text = intent.getStringExtra(EXTRA_HINT) ?: "Point the camera at the QR code"
            setTextColor(Color.WHITE); textSize = 16f; gravity = Gravity.CENTER
            setPadding(32, 32, 32, 16)
        }
        val cancel = Button(this).apply { text = "Cancel"; setOnClickListener { finishWith(null) } }
        val bottom = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setBackgroundColor(Color.argb(170, 0, 0, 0)); setPadding(24, 8, 24, 48)
            addView(hint); addView(cancel)
        }
        setContentView(FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(preview, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(bottom, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        })
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            try {
                val provider = providerFuture.get()
                val shown = Preview.Builder().build().also { it.setSurfaceProvider(preview.surfaceProvider) }
                val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                analysis.setAnalyzer(analysisThread) { proxy -> read(proxy, prefix) }
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, shown, analysis)
            } catch (e: Exception) {
                hint.text = "The camera could not start: ${e.message}"
            }
        }, ContextCompat.getMainExecutor(this))
    }

    @androidx.annotation.OptIn(ExperimentalGetImage::class)
    private fun read(proxy: ImageProxy, prefix: String) {
        val media = proxy.image
        if (media == null || done.get()) { proxy.close(); return }
        scanner.process(InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees))
            .addOnSuccessListener { codes -> QrCodes.matching(codes.mapNotNull { it.rawValue }, prefix)?.let { finishWith(it) } }
            .addOnCompleteListener { proxy.close() }
    }

    private fun finishWith(value: String?) {
        if (!done.compareAndSet(false, true)) return
        runOnUiThread {
            if (value != null) setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_VALUE, value))
            else setResult(Activity.RESULT_CANCELED)
            finish()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        scanner.close()
        analysisThread.shutdown()
    }

    companion object {
        const val EXTRA_PREFIX = "prefix"
        const val EXTRA_HINT = "hint"
        const val EXTRA_VALUE = "value"
    }
}

/** Pure QR helpers (tested on the JVM). */
object QrCodes {
    /** The first code that starts with the prefix (any code when the prefix is empty). */
    fun matching(codes: List<String>, prefix: String): String? = codes.firstOrNull { it.startsWith(prefix) }
}
