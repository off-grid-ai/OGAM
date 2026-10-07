package ai.offgridmobile.litert

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Tests for TensorTpu — whether a phone can run a LiteRT model on its Google Tensor TPU. */
@Suppress("kotlin:S100") // Backtick test names are idiomatic Kotlin
class TensorTpuTest {

    @Test
    fun `reads the generation from a Pixel SOC_MODEL`() {
        assertEquals(5, TensorTpu.generation("Tensor G5", "blazer", "blazer", "blazer"))
        assertEquals(4, TensorTpu.generation("Tensor G4", "caiman", "caiman", "caiman"))
    }

    @Test
    fun `falls back to the SoC or device codename when SOC_MODEL does not name the chip`() {
        assertEquals(5, TensorTpu.generation("", "laguna"))
        assertEquals(5, TensorTpu.generation("", "unknown", "unknown", "mustang"))
        assertEquals(1, TensorTpu.generation("GS101", "oriole", "oriole", "oriole"))
    }

    @Test
    fun `is not a Tensor phone on Snapdragon or MediaTek`() {
        assertNull(TensorTpu.generation("SM8750", "qcom", "sun", "pa3q"))
        assertNull(TensorTpu.generation("MT6989", "mt6989", "k6989v1_64", "duchamp"))
    }

    @Test
    fun `allows the TPU on a Pixel 10 on Android 16 with the dispatch library`() {
        assertNull(TensorTpu.unsupportedReason(5, 36, dispatchLibPresent = true))
    }

    @Test
    fun `explains why the TPU cannot be used`() {
        assertEquals("not_tensor", TensorTpu.unsupportedReason(null, 36, dispatchLibPresent = true))
        assertEquals("android_too_old", TensorTpu.unsupportedReason(5, 35, dispatchLibPresent = true))
        assertEquals("dispatch_lib_missing", TensorTpu.unsupportedReason(5, 36, dispatchLibPresent = false))
    }
}
