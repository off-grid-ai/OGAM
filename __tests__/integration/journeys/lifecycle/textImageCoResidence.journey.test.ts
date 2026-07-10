/**
 * JOURNEY — text ↔ image co-residence under real memory pressure (cluster A).
 *
 * The flow a user drives: they are chatting (a text model is resident), then ask
 * to generate an image with prompt-enhancement ON. The image-gen path:
 *   1. _enhancePrompt runs the ALREADY-resident text model to enrich the prompt, then
 *   2. _ensureImageModelLoaded loads the image model.
 *
 * The residency INVARIANT this suite guards is the developer's own flagged concern
 * (`residents=[text:5235,image:2369] avail=640`): text and image are the two
 * heaviest models and their working sets both need PHYSICAL RAM at once. On a
 * memory-tight device the image load must SWAP THE TEXT MODEL OUT, not co-reside
 * both into an OOM.
 *
 * We drive the REAL imageGenerationService → activeModelService →
 * modelResidencyManager → residency policy → appStore. Only the native engines
 * (llm / litert / localDreamGenerator), the hardware RAM sensor, and the on-disk
 * integrity check are mocked at the boundary. The terminal artifact asserted is
 * getResidents()/isResident() after the generation — NOT "a gate was called".
 *
 * PLATFORM DIVERGENCE (the crux): effectiveAvailableMB (memoryBudget.ts:104) treats
 * Android's raw availMem as an UNDER-count — a foreground app may commit up to the
 * physical budget because the OS reclaims background apps — so it returns
 * max(realAvail, physicalBudget). Under DIRTY pressure (an image model resident/
 * incoming) budgetForSpec (modelResidency/index.ts:230) gates on that value. On
 * Android with 640MB free it becomes max(640, ~8601) = 8601, so the dirty gate is
 * DEFEATED: text(5235)+image(2369)=7604 ≤ 8601 → the balanced policy CO-RESIDES both
 * with only 640MB physically free (the OOM). On iOS effectiveAvailableMB returns the
 * raw 640, the dirty budget is ~640+resident−1024, and the text model is evicted.
 * The same user flow is safe on iOS and an OOM on Android — the leaked platform seam.
 */

import { Platform } from 'react-native';
import { useAppStore } from '../../../../src/stores/appStore';
import { activeModelService } from '../../../../src/services/activeModelService';
import { modelResidencyManager } from '../../../../src/services/modelResidency';
import { imageGenerationService } from '../../../../src/services/imageGenerationService';
import { llmService } from '../../../../src/services/llm';
import { hardwareService } from '../../../../src/services/hardware';
import { localDreamGeneratorService } from '../../../../src/services/localDreamGenerator';
import { resetStores, flushPromises } from '../../../utils/testHelpers';
import {
  createDownloadedModel,
  createONNXImageModel,
  createDeviceInfo,
} from '../../../utils/factories';

jest.mock('../../../../src/services/llm');
jest.mock('../../../../src/services/litert');
jest.mock('../../../../src/services/localDreamGenerator');
jest.mock('../../../../src/services/hardware');
jest.mock('../../../../src/utils/imageModelIntegrity', () => ({
  validateImageModelDir: jest.fn(async () => ({ complete: true, missing: [] })),
  ensureImageExtractionComplete: jest.fn(async () => {}),
}));

const mockLlm = llmService as jest.Mocked<typeof llmService>;
const mockHw = hardwareService as jest.Mocked<typeof hardwareService>;
const mockDream = localDreamGeneratorService as jest.Mocked<
  typeof localDreamGeneratorService
>;

const TEXT_RAM_MB = 5235;
const IMAGE_RAM_MB = 2369;
const TEXT_FILE_BYTES = Math.round((TEXT_RAM_MB / 1.5) * 1024 * 1024);
const IMAGE_FILE_BYTES = Math.round((IMAGE_RAM_MB / 2.5) * 1024 * 1024);

const textModel = () =>
  createDownloadedModel({
    id: 'text-1',
    engine: 'llama' as any,
    fileName: 'text.gguf',
    filePath: '/text.gguf',
    fileSize: TEXT_FILE_BYTES,
  });

const imageModel = () =>
  createONNXImageModel({
    id: 'img-1',
    name: 'SD',
    modelPath: '/img',
    backend: 'mnn',
    size: IMAGE_FILE_BYTES,
  });

const originalOS = Platform.OS;

function wireNativeMocks() {
  let llmLoaded = false;
  mockLlm.isModelLoaded.mockImplementation(() => llmLoaded);
  mockLlm.getLoadedModelPath.mockImplementation(() =>
    llmLoaded ? '/text.gguf' : null,
  );
  mockLlm.loadModel.mockImplementation(async () => {
    llmLoaded = true;
  });
  mockLlm.unloadModel.mockImplementation(async () => {
    llmLoaded = false;
  });
  mockLlm.getMultimodalSupport.mockReturnValue({ vision: false } as any);
  mockLlm.generateResponse.mockResolvedValue('an enhanced, richer prompt');

  let dreamLoaded = false;
  let dreamPath: string | null = null;
  mockDream.isModelLoaded.mockImplementation(async () => dreamLoaded);
  mockDream.getLoadedModelPath.mockImplementation(async () => dreamPath);
  mockDream.getLoadedThreads.mockImplementation(() => (dreamLoaded ? 4 : null));
  mockDream.loadModel.mockImplementation(async (p: string) => {
    dreamLoaded = true;
    dreamPath = p;
    return true;
  });
  mockDream.unloadModel.mockImplementation(async () => {
    dreamLoaded = false;
    dreamPath = null;
    return true;
  });
  mockDream.hasKernelCache.mockResolvedValue(true);
  mockDream.generateImage.mockResolvedValue({
    id: 'gen-1',
    imagePath: '/out.png',
    width: 512,
    height: 512,
  } as any);
}

function wireHardware12GbTight() {
  mockHw.getDeviceInfo.mockResolvedValue(
    createDeviceInfo({ totalMemory: 12 * 1024 * 1024 * 1024 }),
  );
  mockHw.refreshMemoryInfo.mockResolvedValue({} as any);
  mockHw.getTotalMemoryGB.mockReturnValue(12);
  mockHw.getAvailableMemoryGB.mockReturnValue(640 / 1024); // 640MB free — tight
  mockHw.estimateModelRam.mockImplementation(
    (m: any, mult = 1.5) => (m?.fileSize || m?.size || 0) * mult,
  );
  mockHw.estimateImageModelRam.mockImplementation(
    (m: any) => (m?.size || m?.fileSize || 0) * 2.5,
  );
  mockHw.getModelTotalSize.mockImplementation(
    (m: any) => m?.fileSize || m?.size || 0,
  );
  mockHw.preferGpuForImageGen.mockReturnValue(false);
  mockHw.getSoCInfo = jest.fn(async () => ({ hasNPU: false })) as any;
}

async function setupState() {
  useAppStore.setState({
    downloadedModels: [textModel()],
    downloadedImageModels: [imageModel()],
    activeModelId: 'text-1',
    activeImageModelId: 'img-1',
    settings: { ...useAppStore.getState().settings, enhanceImagePrompts: true },
  });
  modelResidencyManager.setBudgetOverrideMB(null);
  modelResidencyManager.setLoadPolicy('balanced');
  await activeModelService.syncWithNativeState();
}

describe('JOURNEY: text↔image co-residence under memory pressure', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    modelResidencyManager._reset();
    wireNativeMocks();
    wireHardware12GbTight();
    await setupState();
  });

  afterEach(() => {
    modelResidencyManager.setBudgetOverrideMB(null);
    Platform.OS = originalOS;
  });

  it('chat text model is resident before image gen', async () => {
    await activeModelService.loadTextModel('text-1');
    expect(modelResidencyManager.isResident('text')).toBe(true);
    expect(mockLlm.isModelLoaded()).toBe(true);
  });

  it('iOS (safe): image gen with a resident text model evicts the text model — never co-resident on a 640MB-free device', async () => {
    Platform.OS = 'ios' as typeof Platform.OS;
    await activeModelService.loadTextModel('text-1');
    expect(modelResidencyManager.isResident('text')).toBe(true);

    await imageGenerationService.generateImage({ prompt: 'a cat' });
    await flushPromises();

    expect(modelResidencyManager.isResident('image')).toBe(true);
    expect(mockDream.generateImage).toHaveBeenCalledTimes(1);
    // Terminal artifact: only the image model resident.
    expect(modelResidencyManager.getResidents().map(r => r.key).sort()).toEqual([
      'image',
    ]);
  });

  // it.failing: this asserts the CORRECT (safe) behavior — the text model swapped
  // out — which does NOT hold on HEAD (Android co-resides both → OOM). It is GREEN
  // today (documenting the known bug as a guard) and turns RED the instant the
  // swap-out fix lands, forcing a re-check. See BUG #1 in the QA report. Do not
  // "fix" this by relaxing the assertion — the assertion is the spec.
  it.failing('THE CONCERN (Android): image gen with a resident text model must SWAP OUT text — it must NOT co-reside text+image with 640MB free (OOM)', async () => {
    Platform.OS = 'android' as typeof Platform.OS;
    // 1. Chatting — text resident.
    await activeModelService.loadTextModel('text-1');
    expect(modelResidencyManager.isResident('text')).toBe(true);

    // 2. Image gen with enhancement ON.
    await imageGenerationService.generateImage({ prompt: 'a cat' });
    await flushPromises();

    const residents = modelResidencyManager.getResidents();
    const keys = residents.map(r => r.key).sort();
    const totalResidentMB = residents.reduce((s, r) => s + r.sizeMB, 0);

    expect(modelResidencyManager.isResident('image')).toBe(true);
    expect(mockDream.generateImage).toHaveBeenCalledTimes(1);

    // THE INVARIANT: on a device with only 640MB physically free, holding BOTH a
    // 5235MB text and a 2369MB image model resident (7604MB working set) is an OOM.
    // The image load must have evicted the text model. FAILS on HEAD — Android's
    // effectiveAvailableMB defeats the dirty gate so both co-reside.
    expect(keys).toEqual(['image']);
    expect(modelResidencyManager.isResident('text')).toBe(false);
    expect(totalResidentMB).toBeLessThanOrEqual(IMAGE_RAM_MB + 1);
  });
});
