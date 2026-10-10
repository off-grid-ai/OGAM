package ai.offgridmobile.litert

/**
 * Can this phone run a LiteRT model on its Google Tensor TPU? Pure (no Android deps) so it is
 * unit-testable; [LiteRTModule.getTpuSupport] feeds it the Build properties and runtime probes.
 */
internal object TensorTpu {
    /** LiteRT's Google Tensor dispatch library, shipped in the app's native lib dir. */
    const val DISPATCH_LIB = "libLiteRtDispatch_GoogleTensor.so"
    /** The Pixel vendor library the dispatch library opens (System.loadLibrary name). */
    const val VENDOR_LIB = "edgetpu_litert"
    /** LiteRT supports the Tensor TPU from Android 16 (API 36). */
    const val MIN_SDK = 36
    /** LiteRT's own NPU check rejects this Android 16 build family: it shipped without NPU support. */
    private const val UNSUPPORTED_BUILD_PREFIX = "BP2A"

    private val SOC_MODEL = Regex("""^tensor\s*g(\d+)$""")

    /**
     * Tensor generation (5 for a Pixel 10's "Tensor G5"), or null when this is not a Google Tensor
     * SoC. Every Tensor G3+ Pixel reports SOC_MODEL "Tensor G<n>" with SOC_MANUFACTURER "Google"
     * (factory images); device codenames are not used — other vendors reuse them.
     */
    fun generation(socModel: String, socManufacturer: String): Int? {
        if (!socManufacturer.equals("Google", ignoreCase = true)) return null
        return SOC_MODEL.find(socModel.trim().lowercase())?.groupValues?.get(1)?.toIntOrNull()
    }

    /** Why the TPU can't be used here, or null when it can. */
    fun unsupportedReason(
        generation: Int?,
        sdkInt: Int,
        buildId: String,
        dispatchLibPresent: Boolean,
        vendorLibLoads: Boolean,
        previousInitCrashed: Boolean,
    ): String? = when {
        generation == null -> "not_tensor"
        sdkInt < MIN_SDK -> "android_too_old"
        buildId.startsWith(UNSUPPORTED_BUILD_PREFIX) -> "android_build_unsupported"
        !dispatchLibPresent -> "dispatch_lib_missing"
        !vendorLibLoads -> "vendor_lib_unavailable"
        previousInitCrashed -> "previous_tpu_load_crashed"
        else -> null
    }
}
