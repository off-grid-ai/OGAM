/**
 * JOURNEY — switch text models, and the Load-Anyway override across a swap (cluster A).
 *
 * Flow: load text model A → switch to text model B (B must EVICT A, not co-reside two
 * generation models into OOM) → the "text" slot holds exactly one model. Then the
 * cross-engine variant (llama A → LiteRT B) must also leave exactly one resident.
 *
 * Second flow: a big model force-loaded via "Load Anyway" records a SESSION override
 * (modelResidency.sessionOverrides). When it is later evicted by a swap and reloaded,
 * the override must persist so the user is NOT re-prompted — the load skips the gate.
 *
 * Drives the REAL activeModelService + modelResidencyManager; only native engines +
 * RAM sensor mocked. Terminal artifact: getResidents()/isResident() + which native
 * engine is loaded + hasSessionOverride.
 */

import { Platform } from 'react-native';
import { useAppStore } from '../../../../src/stores/appStore';
import { activeModelService } from '../../../../src/services/activeModelService';
import { modelResidencyManager } from '../../../../src/services/modelResidency';
import { llmService } from '../../../../src/services/llm';
import { liteRTService } from '../../../../src/services/litert';
import { hardwareService } from '../../../../src/services/hardware';
import { resetStores, flushPromises } from '../../../utils/testHelpers';
import { createDownloadedModel, createDeviceInfo } from '../../../utils/factories';

jest.mock('../../../../src/services/llm');
jest.mock('../../../../src/services/litert');
jest.mock('../../../../src/services/localDreamGenerator');
jest.mock('../../../../src/services/hardware');

const mockLlm = llmService as jest.Mocked<typeof llmService>;
const mockLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;
const mockHw = hardwareService as jest.Mocked<typeof hardwareService>;

const gguf = (id: string, ramMB: number) =>
  createDownloadedModel({
    id,
    engine: 'llama' as any,
    fileName: `${id}.gguf`,
    filePath: `/${id}.gguf`,
    fileSize: Math.round((ramMB / 1.5) * 1024 * 1024),
  });

const litert = (id: string, ramMB: number) =>
  createDownloadedModel({
    id,
    engine: 'litert' as any,
    fileName: `${id}.task`,
    filePath: `/${id}.task`,
    fileSize: Math.round((ramMB / 1.5) * 1024 * 1024),
  });

const originalOS = Platform.OS;

describe('JOURNEY: text model swap + Load-Anyway persistence', () => {
  /** In-memory llama native state driven by the real service on top. */
  let llamaLoadedPath: string | null;
  /** In-memory litert native state. */
  let litertLoaded: boolean;

  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    modelResidencyManager._reset();
    llamaLoadedPath = null;
    litertLoaded = false;

    mockLlm.isModelLoaded.mockImplementation(() => llamaLoadedPath != null);
    mockLlm.getLoadedModelPath.mockImplementation(() => llamaLoadedPath);
    mockLlm.loadModel.mockImplementation(async (p: string) => {
      llamaLoadedPath = p;
    });
    mockLlm.unloadModel.mockImplementation(async () => {
      llamaLoadedPath = null;
    });
    mockLlm.getMultimodalSupport.mockReturnValue({ vision: false } as any);

    mockLiteRT.isModelLoaded.mockImplementation(() => litertLoaded);
    mockLiteRT.isAvailable.mockReturnValue(true);
    mockLiteRT.loadModel.mockImplementation(async () => {
      litertLoaded = true;
      return true as any;
    });
    mockLiteRT.unloadModel.mockImplementation(async () => {
      litertLoaded = false;
      return true as any;
    });
    mockLiteRT.getActiveBackend.mockReturnValue('gpu' as any);
    mockLiteRT.warmup.mockResolvedValue(undefined as any);

    mockHw.getDeviceInfo.mockResolvedValue(
      createDeviceInfo({ totalMemory: 12 * 1024 * 1024 * 1024 }),
    );
    mockHw.refreshMemoryInfo.mockResolvedValue({} as any);
    mockHw.getTotalMemoryGB.mockReturnValue(12);
    mockHw.getAvailableMemoryGB.mockReturnValue(8); // roomy
    mockHw.estimateModelRam.mockImplementation(
      (m: any, mult = 1.5) => (m?.fileSize || m?.size || 0) * mult,
    );
    mockHw.getModelTotalSize.mockImplementation(
      (m: any) => m?.fileSize || m?.size || 0,
    );

    Platform.OS = 'ios' as typeof Platform.OS;
    modelResidencyManager.setLoadPolicy('balanced');
    await activeModelService.syncWithNativeState();
  });

  afterEach(() => {
    modelResidencyManager.setBudgetOverrideMB(null);
    Platform.OS = originalOS;
  });

  it('switching text model A → B (same engine) leaves exactly ONE resident text model', async () => {
    useAppStore.setState({ downloadedModels: [gguf('a', 3000), gguf('b', 3000)], activeModelId: 'a' });
    await activeModelService.loadTextModel('a');
    expect(modelResidencyManager.isResident('text')).toBe(true);
    expect(mockLlm.getLoadedModelPath()).toBe('/a.gguf');

    await activeModelService.loadTextModel('b');
    await flushPromises();

    // TERMINAL: one text resident, and it is B (A evicted, never co-resident).
    expect(modelResidencyManager.getResidents().filter(r => r.type === 'text')).toHaveLength(1);
    expect(mockLlm.getLoadedModelPath()).toBe('/b.gguf');
    expect(useAppStore.getState().activeModelId).toBe('b');
  });

  it('cross-engine switch (llama A → LiteRT B) unloads the llama model — never both engines resident', async () => {
    useAppStore.setState({ downloadedModels: [gguf('a', 3000), litert('b', 3000)], activeModelId: 'a' });
    await activeModelService.loadTextModel('a');
    expect(mockLlm.isModelLoaded()).toBe(true);

    await activeModelService.loadTextModel('b');
    await flushPromises();

    // TERMINAL: LiteRT loaded, llama unloaded, one 'text' resident.
    expect(mockLiteRT.isModelLoaded()).toBe(true);
    expect(mockLlm.isModelLoaded()).toBe(false);
    expect(modelResidencyManager.getResidents().filter(r => r.type === 'text')).toHaveLength(1);
    expect(useAppStore.getState().activeModelId).toBe('b');
  });

  it('Load-Anyway override persists across a swap: a force-loaded model reloads WITHOUT re-prompting after being evicted', async () => {
    // Budget so tight that model 'big' only loads via override.
    modelResidencyManager.setBudgetOverrideMB(2000);
    useAppStore.setState({ downloadedModels: [gguf('big', 3000), gguf('other', 1500)], activeModelId: 'big' });

    // First load WITHOUT override → refused (overridable).
    await expect(activeModelService.loadTextModel('big')).rejects.toThrow(/Not enough free memory/);
    expect(modelResidencyManager.isResident('text')).toBe(false);

    // User taps Load Anyway → force load, records the session override.
    await activeModelService.loadTextModel('big', undefined, { override: true });
    expect(modelResidencyManager.isResident('text')).toBe(true);
    expect(modelResidencyManager.hasSessionOverride('big')).toBe(true);

    // Swap to 'other' (evicts big), then back to big. Because the override persists,
    // the reload must SUCCEED with no refusal — the gate is skipped for 'big'.
    await activeModelService.loadTextModel('other');
    await flushPromises();
    expect(mockLlm.getLoadedModelPath()).toBe('/other.gguf');

    await activeModelService.loadTextModel('big'); // NO override flag this time
    await flushPromises();

    // TERMINAL: big reloaded despite the tight budget (session override honored).
    expect(mockLlm.getLoadedModelPath()).toBe('/big.gguf');
    expect(modelResidencyManager.isResident('text')).toBe(true);
    expect(useAppStore.getState().activeModelId).toBe('big');
  });
});
