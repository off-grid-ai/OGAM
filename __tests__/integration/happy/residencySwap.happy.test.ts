/**
 * HAPPY-PATH (integration) — smart budgeting / routing: switching text models swaps engines so only ONE
 * heavy text model is resident at a time (a LiteRT model is unloaded when a llama.cpp model loads).
 *
 * Real activeModelService + modelResidencyManager + liteRTService + llmService over faked native + memfs.
 * No mock of the swap logic — asserts the actual engine residency after the switch.
 *
 * DOCUMENTED EXCEPTION to the UI-gesture rule (per the hygiene standard): model selection is a real gesture
 * elsewhere (the Home picker tap), but the thing under test is the single-heavy-resident INVARIANT — an
 * accounting rule with no single UI gesture. Tested at the owning service (activeModelService), asserting the
 * resident set, per the "genuinely gesture-less invariant" carve-out.
 */
import { installNativeBoundary, GB, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

describe('happy — switching text models swaps the engine (one heavy model resident)', () => {
  it('unloads the LiteRT model when a llama.cpp model is loaded', async () => {
    const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    requireRTL();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { activeModelService } = require('../../../src/services/activeModelService');
    const { liteRTService } = require('../../../src/services/litert');
    const { llmService } = require('../../../src/services/llm');
    const { hardwareService } = require('../../../src/services/hardware');
    const { useAppStore } = require('../../../src/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
    await hardwareService.refreshMemoryInfo();

    const litertModel = createDownloadedModel({ id: 'lrt', engine: 'litert', filePath: '/models/gemma.litertlm' });
    const llamaModel = createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf' });
    useAppStore.setState({ downloadedModels: [litertModel, llamaModel], activeModelId: null });

    // Load the LiteRT model first — through the REAL load path so residency is registered.
    await activeModelService.loadTextModel('lrt');
    expect(liteRTService.isModelLoaded()).toBe(true);

    // Switch to the llama model — the swap must unload LiteRT (single heavy text model).
    await activeModelService.loadTextModel('llm');

    expect(llmService.isModelLoaded()).toBe(true);
    expect(liteRTService.isModelLoaded()).toBe(false); // swapped out — not co-resident
  });
});
