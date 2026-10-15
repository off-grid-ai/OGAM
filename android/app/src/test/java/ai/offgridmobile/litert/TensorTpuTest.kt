package ai.offgridmobile.litert

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Tests for TensorTpu — whether a phone can run a LiteRT model on its Google Tensor TPU.
 * SOC_MODEL / SOC_MANUFACTURER values are the ones Google's factory images report (vendor build.prop).
 */
@Suppress("kotlin:S100") // Backtick test names are idiomatic Kotlin
class TensorTpuTest {

    @Test
    fun `reads the generation from a Pixel's SOC_MODEL`() {
        assertEquals(5, TensorTpu.generation("Tensor G5", "Google")) // Pixel 10 family
        assertEquals(4, TensorTpu.generation("Tensor G4", "Google")) // Pixel 9 family, Pixel 10a
        assertEquals(3, TensorTpu.generation("Tensor G3", "Google")) // Pixel 8 family
        assertEquals(6, TensorTpu.generation("Tensor G6", "Google")) // Pixel 11 family
    }

    @Test
    fun `is not a Tensor TPU when the chip carries no generation`() {
        assertNull(TensorTpu.generation("Tensor", "Google")) // Pixel 6
        assertNull(TensorTpu.generation("GS201", "Google")) // Pixel 7
    }

    @Test
    fun `is not a Tensor TPU on other vendors, even with a look-alike SOC_MODEL`() {
        assertNull(TensorTpu.generation("SM8750", "QTI"))
        assertNull(TensorTpu.generation("MT6989", "Mediatek"))
        assertNull(TensorTpu.generation("Tensor G5", "Other"))
        assertNull(TensorTpu.generation("", ""))
    }

    @Test
    fun `allows the TPU on a Pixel 10 on Android 16 with a working runtime`() {
        assertNull(reason())
    }

    @Test
    fun `explains why the TPU cannot be used`() {
        assertEquals("not_tensor", reason(generation = null))
        assertEquals("android_too_old", reason(sdkInt = 35))
        assertEquals("android_build_unsupported", reason(buildId = "BP2A.250605.031"))
        assertEquals("dispatch_lib_missing", reason(dispatchLibPresent = false))
        assertEquals("vendor_lib_unavailable", reason(vendorLibLoads = false))
        assertEquals("previous_tpu_load_crashed", reason(previousInitCrashed = true))
    }

    private fun reason(
        generation: Int? = 5,
        sdkInt: Int = 36,
        buildId: String = "CP3A.261005.005",
        dispatchLibPresent: Boolean = true,
        vendorLibLoads: Boolean = true,
        previousInitCrashed: Boolean = false,
    ) = TensorTpu.unsupportedReason(generation, sdkInt, buildId, dispatchLibPresent, vendorLibLoads, previousInitCrashed)
}
