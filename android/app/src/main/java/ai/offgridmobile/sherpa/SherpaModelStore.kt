package ai.offgridmobile.sherpa

import android.content.Context
import java.io.File

/**
 * Resolves the on-device sherpa model files. The segmentation model + the default (CAM++) embedding
 * ship bundled in the app under assets/sherpa/; the native API wants real file paths (we construct it
 * with a null AssetManager), so we copy those assets into filesDir once. Alternate embeddings are
 * downloaded by JS (sherpaModelDownload) and passed straight through as an absolute path — matching
 * the iOS module. The prepare() URLs are unused on-device because the bundle is baked into the app.
 */
object SherpaModelStore {
  private const val ASSET_DIR = "sherpa"
  private const val SEG_NAME = "segmentation.onnx"
  private const val EMB_NAME = "embedding.onnx"

  /** Copy the bundled models out of assets into filesDir on first use. Idempotent. */
  fun ensure(context: Context, id: String, segmentationUrl: String, embeddingUrl: String) {
    copyAssetIfNeeded(context, SEG_NAME)
    copyAssetIfNeeded(context, EMB_NAME)
  }

  /** Absolute path to the shared segmentation model. */
  fun segmentationPath(context: Context): String {
    copyAssetIfNeeded(context, SEG_NAME)
    return dest(context, SEG_NAME).absolutePath
  }

  /** Absolute path to the bundled default (CAM++) embedding model. */
  fun defaultEmbeddingPath(context: Context): String {
    copyAssetIfNeeded(context, EMB_NAME)
    return dest(context, EMB_NAME).absolutePath
  }

  /**
   * The embedding model to use: a downloaded alternate (passed from JS) when it exists, else the
   * bundled default — mirrors the iOS resolveEmb().
   */
  fun resolveEmbeddingPath(context: Context, downloaded: String?): String {
    if (!downloaded.isNullOrEmpty()) {
      val clean = if (downloaded.startsWith("file://")) downloaded.substring(7) else downloaded
      if (File(clean).exists()) return clean
    }
    return defaultEmbeddingPath(context)
  }

  private fun dir(context: Context): File = File(context.filesDir, ASSET_DIR).apply { mkdirs() }

  private fun dest(context: Context, name: String): File = File(dir(context), name)

  private fun copyAssetIfNeeded(context: Context, name: String) {
    val out = dest(context, name)
    if (out.exists() && out.length() > 0) return
    context.assets.open("$ASSET_DIR/$name").use { input ->
      out.outputStream().use { output -> input.copyTo(output, 1 shl 16) }
    }
  }
}
