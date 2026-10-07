package ai.offgridmobile.litert

/**
 * Can this phone run a LiteRT model on its Google Tensor TPU? Pure (no Android deps) so it is
 * unit-testable; [LiteRTModule.getTpuSupport] feeds it the Build properties.
 */
internal object TensorTpu {
    /** LiteRT's Google Tensor dispatch library, shipped in the app's native lib dir. */
    const val DISPATCH_LIB = "libLiteRtDispatch_GoogleTensor.so"
    /** LiteRT supports the Tensor TPU from Android 16 (API 36). */
    const val MIN_SDK = 36

    /** Pixel SoC and device codenames → Tensor generation, for builds whose SOC_MODEL doesn't name the chip. */
    private val CODENAMES = mapOf(
        "gs101" to 1, "gs201" to 2, "zuma" to 3, "zumapro" to 4, "laguna" to 5, "malibu" to 6,
        // Pixel 10, 10 Pro, 10 Pro XL, 10 Pro Fold
        "frankel" to 5, "blazer" to 5, "mustang" to 5, "rango" to 5,
    )
    private val SOC_MODEL = Regex("""tensor\s*g?(\d+)""")

    /**
     * Tensor generation (5 for a Pixel 10's "Tensor G5"), or null when this is not a Tensor SoC.
     * [socModel] is Build.SOC_MODEL; [codenames] are Build.HARDWARE / BOARD / DEVICE.
     */
    fun generation(socModel: String, vararg codenames: String): Int? {
        SOC_MODEL.find(socModel.lowercase())?.let { return it.groupValues[1].toIntOrNull() }
        // Older Pixels report the SoC codename itself as SOC_MODEL ("GS101").
        return (listOf(socModel) + codenames).firstNotNullOfOrNull { CODENAMES[it.lowercase()] }
    }

    /** Why the TPU can't be used here, or null when it can. */
    fun unsupportedReason(generation: Int?, sdkInt: Int, dispatchLibPresent: Boolean): String? = when {
        generation == null -> "not_tensor"
        sdkInt < MIN_SDK -> "android_too_old"
        !dispatchLibPresent -> "dispatch_lib_missing"
        else -> null
    }
}
