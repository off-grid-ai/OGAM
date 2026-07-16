/**
 * HAPPY-PATH (integration) — smart budgeting / routing: switching text models swaps residency so only ONE
 * heavy text model is accounted resident at a time (loading a llama.cpp model evicts the LiteRT one).
 *
 * Real activeModelService + modelResidencyManager + liteRTService + llmService over faked native + memfs.
 * Model load goes through the REAL load path (activeModelService.loadTextModel) so residency is registered.
 *
 * ASSERTS THE RESIDENCY MANAGER'S ACCOUNTING (modelResidencyManager.getResidents()) — the single-heavy-text
 * invariant is an accounting rule (per the §4 gesture-less-invariant carve-out). This is the FIX for a prior
 * FALSE GREEN: the old test asserted engine booleans (liteRTService/llmService.isModelLoaded), which the
 * REDUNDANT unloadAllTextEngines() satisfies even if the residency SWAP is deleted — so the residency
 * accounting could go stale/co-resident and the test stayed green. getResidents() reflects the accounting,
 * which only updates when the swap's register runs — so a swap regression is caught.
 *
 * Keeps BOTH states as a proven transition: after LiteRT loads, the one text resident is 'lrt'; after llama
 * loads, it is 'llm' (LiteRT evicted from the accounting, never co-resident). Falsified: skipping the text
 * register in the swap leaves the resident stale as 'lrt' after the switch → red.
 */
import { installNativeBoundary, GB, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

describe('happy — switching text models swaps residency (one heavy model accounted resident)', () => {
  it('evicts the LiteRT model from residency when a llama.cpp model is loaded', async () => {
    const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    requireRTL();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { activeModelService } = require('../../../src/services/activeModelService');
    const { modelResidencyManager } = require('../../../src/services/modelResidency');
    const { hardwareService } = require('../../../src/services/hardware');
    const { useAppStore } = require('../../../src/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
    await hardwareService.refreshMemoryInfo();

    const litertModel = createDownloadedModel({ id: 'lrt', engine: 'litert', filePath: '/models/gemma.litertlm' });
    const llamaModel = createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf' });
    useAppStore.setState({ downloadedModels: [litertModel, llamaModel], activeModelId: null });

    const textResidents = () => (modelResidencyManager.getResidents() as Array<{ type: string; modelId?: string }>)
      .filter(r => r.type === 'text').map(r => r.modelId);

    // Load the LiteRT model first — the accounting has exactly one text resident: lrt.
    await activeModelService.loadTextModel('lrt');
    expect(textResidents()).toEqual(['lrt']);

    // Switch to the llama model — the swap must evict LiteRT from the accounting (single heavy text model).
    await activeModelService.loadTextModel('llm');
    // Exactly one text resident, and it is the llama model — LiteRT is gone, not co-resident/stale.
    expect(textResidents()).toEqual(['llm']);
  });
});
