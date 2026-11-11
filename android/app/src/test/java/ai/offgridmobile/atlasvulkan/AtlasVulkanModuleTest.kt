package ai.offgridmobile.atlasvulkan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AtlasVulkanModuleTest {

    @Test
    fun offloadIsCappedAtBlocksPlusOutputLayer() {
        assertEquals(29, AtlasVulkanModule.offloadedLayers(99, 28, onVulkan = true))
        assertEquals(12, AtlasVulkanModule.offloadedLayers(12, 28, onVulkan = true))
    }

    @Test
    fun noOffloadReportedWhenNotOnVulkan() {
        assertEquals(0, AtlasVulkanModule.offloadedLayers(99, 28, onVulkan = false))
        assertEquals(0, AtlasVulkanModule.offloadedLayers(0, 28, onVulkan = true))
    }

    @Test
    fun unknownWhenModelHeaderUnreadable() {
        assertEquals(-1, AtlasVulkanModule.offloadedLayers(99, -1, onVulkan = true))
    }

    @Test
    fun vulkanGpuDetectionRequiresGpuTypeAndVulkanBackend() {
        assertTrue(AtlasVulkanModule.isVulkanGpu(mapOf("name" to "Adreno 830", "description" to "Vulkan", "type" to "gpu")))
        assertTrue(AtlasVulkanModule.isVulkanGpu(mapOf("name" to "Mali-G57", "description" to "Vulkan", "type" to "igpu")))
        assertFalse(AtlasVulkanModule.isVulkanGpu(mapOf("name" to "CPU", "description" to "CPU", "type" to "cpu")))
        assertFalse(AtlasVulkanModule.isVulkanGpu(mapOf("name" to "Adreno", "description" to "OpenCL", "type" to "gpu")))
    }
}
