/**
 * Integration Tests: STT (Whisper) residency — the single-model invariant.
 *
 * This is the test that WOULD HAVE CAUGHT the shipped bug where the voice
 * pipeline held the Whisper STT model AND the text model in RAM at the same
 * time, OOM-ing the app and forcing the user to resend.
 *
 * Why the old suite missed it: `whisperStore.test.ts` mocked the residency
 * manager's `makeRoomFor` to ALWAYS return `{ fits: true }` and only asserted
 * that `makeRoomFor`/`loadModel` were *called*. That is a false green — it
 * passes whether or not the store RESPECTS the verdict, and the bug was
 * precisely that the store ignored `fits` and loaded anyway.
 *
 * This test drives the REAL whisperStore, whisperService, activeModelService, llmService and
 * modelResidencyManager. Only the phone is faked: whisper.rn and llama.rn (the native engines), the
 * disk and the RAM sensor (installNativeBoundary). It asserts the OUTCOME a user cares about: how many
 * models are resident, and whether the native whisper model was ever opened. Deleting the
 * `if (!fits) return` guard in the store fails these tests.
 */
import { installNativeBoundary, GB, MB, type NativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

const WHISPER = 'base';
/** The text model that was force-loaded ("Load Anyway") on the device: bigger than the budget alone. */
const TEXT_MODEL_BYTES = 8537 * MB;

let boundary: NativeBoundary;
let residency: any;
let activeModelService: any;
let useWhisperStore: any;

/** How many times the native whisper model was opened. */
const whisperOpens = (): number => boundary.whisper!.module.initWhisper.mock.calls.length;

beforeEach(async () => {
  // Device under test: the 12GB Android phone that OOM'd.
  boundary = installNativeBoundary({
    llama: true, whisper: true, fs: true,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 4.5 * GB },
  });
  const { hardwareService } = require('../../../src/services/hardware');
  const { useAppStore } = require('../../../src/stores');
  const { whisperService } = require('../../../src/services/whisperService');
  ({ modelResidencyManager: residency } = require('../../../src/services/modelResidency'));
  ({ activeModelService } = require('../../../src/services/activeModelService'));
  ({ useWhisperStore } = require('../../../src/stores/whisperStore'));
  await hardwareService.refreshMemoryInfo();

  // Pin the budget the device had (11297MB usable → ~7908MB on Android) so the invariant is
  // deterministic. The text model (8537MB) alone exceeds it — it was force-loaded via override — so a
  // 142MB whisper sidecar CANNOT co-reside without evicting it, and residency won't evict a generation
  // model for a sidecar. That is the exact device state.
  residency.setLoadPolicy('balanced');
  residency.setBudgetOverrideMB(7908);

  // A downloaded text model, as a finished download leaves it: its file on disk and its record added.
  const filePath = `${boundary.fs!.DocumentDirectoryPath}/models/big.gguf`;
  boundary.fs!.seedFile(filePath, 500 * MB);
  useAppStore.getState().addDownloadedModel(createDownloadedModel({
    id: 'big', name: 'Big Model', engine: 'llama', filePath, fileName: 'big.gguf', fileSize: TEXT_MODEL_BYTES,
  }));
  activeModelService.selectTextModel('big');

  // The whisper model file is on disk.
  boundary.fs!.seedFile(whisperService.getModelPath(WHISPER), 142 * MB);
});

/** The person loads the big text model with "Load Anyway". */
const loadTextAnyway = () => activeModelService.loadTextModel('big', undefined, { override: true });

describe('STT residency — single-model invariant', () => {
  it('loads whisper when nothing else is resident', async () => {
    await useWhisperStore.getState().selectModel(WHISPER);

    expect(whisperOpens()).toBe(1);
    expect(residency.isResident('whisper')).toBe(true);
    expect(useWhisperStore.getState().isModelLoaded).toBe(true);
  });

  it('does NOT load whisper alongside a heavier resident text model (the OOM regression)', async () => {
    // The text model is resident (like right after a voice "Load Anyway"). Residency will NOT evict an
    // 8.5GB generation model to make room for a 142MB sidecar, so makeRoomFor returns fits=false. The
    // store must honor that and stay out.
    await loadTextAnyway();
    expect(residency.isResident('text')).toBe(true);

    await useWhisperStore.getState().selectModel(WHISPER);
    await useWhisperStore.getState().loadModel();

    // The invariant: exactly ONE model resident — the text model, not both.
    expect(whisperOpens()).toBe(0);
    expect(residency.isResident('whisper')).toBe(false);
    expect(residency.isResident('text')).toBe(true);
    expect(residency.getResidents()).toHaveLength(1);
    // Not an error — STT just loads on the next record when there's room.
    expect(useWhisperStore.getState().isModelLoaded).toBe(false);
    expect(useWhisperStore.getState().error).toBeNull();
  });

  it('a text load evicts a resident whisper, and whisper does not fight its way back', async () => {
    // 1. Whisper resident (user recorded a voice note).
    await useWhisperStore.getState().selectModel(WHISPER);
    expect(residency.isResident('whisper')).toBe(true);

    // 2. The big text model loads with override (Load Anyway) — this evicts whisper.
    await loadTextAnyway();
    expect(residency.isResident('text')).toBe(true);
    expect(residency.isResident('whisper')).toBe(false);
    // whisper's unload ran → store flag cleared (the eviction path).
    expect(useWhisperStore.getState().isModelLoaded).toBe(false);

    // 3. The reactive auto-load effect (or any retry) tries to bring whisper back while the text model
    //    owns memory. It must NOT succeed — otherwise we're back to whisper+text co-resident.
    await useWhisperStore.getState().loadModel();

    expect(whisperOpens()).toBe(1);
    expect(residency.isResident('whisper')).toBe(false);
    expect(residency.isResident('text')).toBe(true);
    expect(residency.getResidents()).toHaveLength(1);
  });

  it('after the text model unloads, whisper can load again', async () => {
    await loadTextAnyway();
    await useWhisperStore.getState().selectModel(WHISPER);
    expect(residency.isResident('whisper')).toBe(false);

    // Text model goes away (the person ejects it).
    await activeModelService.unloadTextModel();

    await useWhisperStore.getState().loadModel();
    expect(residency.isResident('whisper')).toBe(true);
    expect(useWhisperStore.getState().isModelLoaded).toBe(true);
  });
});
