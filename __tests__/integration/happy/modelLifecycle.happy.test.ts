/**
 * INTEGRATION (residency/lifecycle INVARIANT) — load → resident/ready, unload → not resident, delete →
 * removed from the library. Drives the REAL activeModelService + modelResidencyManager + llmService over
 * the faked native leaf + memfs. No mock of the lifecycle logic.
 *
 * DOCUMENTED EXCEPTION to the UI-gesture rule (per the hygiene standard): the LOAD is a real user gesture
 * elsewhere (the Home model-picker tap — see setupChatScreen), but the thing under test here is the residency
 * INVARIANT (isResident/getResidents accounting), which has no single UI gesture — it's an accounting rule
 * that spans load/unload/delete across screens. So it's tested at the owning service (activeModelService),
 * asserting the resident set, per the "genuinely gesture-less invariant" carve-out.
 */
import { installNativeBoundary, GB, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

describe('happy — model lifecycle (load / unload / delete)', () => {
  it('loads a text model (resident + ready), unloads it, and deletes it from the library', async () => {
    const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    requireRTL();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { activeModelService } = require('../../../src/services/activeModelService');
    const { modelResidencyManager } = require('../../../src/services/modelResidency');
    const { isModelReady } = require('../../../src/services/engines');
    const { hardwareService } = require('../../../src/services/hardware');
    const { useAppStore } = require('../../../src/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
    await hardwareService.refreshMemoryInfo();
    const model = createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf' });
    useAppStore.setState({ downloadedModels: [model], activeModelId: null });

    // Load — becomes ready + resident.
    await activeModelService.loadTextModel('llm');
    expect(isModelReady(model)).toBe(true);
    expect(modelResidencyManager.isResident('text')).toBe(true);

    // Unload — no longer ready/resident.
    await activeModelService.unloadTextModel();
    expect(isModelReady(model)).toBe(false);
    expect(modelResidencyManager.isResident('text')).toBe(false);

    // Delete — removed from the library.
    useAppStore.getState().removeDownloadedModel('llm');
    expect(useAppStore.getState().downloadedModels.find((m: { id: string }) => m.id === 'llm')).toBeUndefined();
  });
});
