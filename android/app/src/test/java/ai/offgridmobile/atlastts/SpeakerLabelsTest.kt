package ai.offgridmobile.atlastts

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class SpeakerLabelsTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test
    fun findsBothModelsOrNothing() {
        val dir = tmp.newFolder("atlas-speakers")
        File(dir, "segmentation.onnx").writeText("s")
        assertNull(SpeakerLabels.modelsIn(dir))
        File(dir, "embedding.onnx").writeText("e")
        assertNotNull(SpeakerLabels.modelsIn(dir))
    }

    @Test
    fun resamplesToTheModelRate() {
        val x = floatArrayOf(0f, 1f, 2f, 3f)
        assertArrayEquals(x, SpeakerLabels.resample(x, 16000, 16000), 0f)
        val up = SpeakerLabels.resample(x, 8000, 16000)
        assertEquals(8, up.size)
        assertEquals(0.5f, up[1], 1e-6f)
        assertEquals(2, SpeakerLabels.resample(x, 32000, 16000).size)
    }
}
