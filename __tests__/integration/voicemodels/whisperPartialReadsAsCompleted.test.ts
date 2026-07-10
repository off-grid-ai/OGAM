/**
 * Voice-model BUG HUNT — an interrupted Whisper download left on disk is reported
 * as a COMPLETED, usable model (B7/B8 class).
 *
 * Whisper downloads write directly to the FINAL path `ggml-<id>.bin` (no .part/.tmp
 * sidecar; whisperService.downloadModel destPath = getModelPath). On a clean JS
 * error/cancel the finally/catch unlinks it — but an app-KILL mid-download runs
 * neither, so a truncated `ggml-<id>.bin` persists.
 *
 * On relaunch, whisperService.listDownloadedModels() (the source useVoiceDownloadItems
 * + sttProvider read) filters purely on name (`ggml-*.bin`) with NO size/integrity
 * check, so the partial file is surfaced as a `completed` model. The downloadStore is
 * not persisted, so sttProvider.reconcile() sees an empty store and cannot surface it
 * as failed/retriable either.
 *
 * Terminal artifact asserted: a 3MB partial `ggml-base.en.bin` (below the service's
 * own 10MB MIN_MODEL_FILE_SIZE validity floor) must NOT be listed as a completed
 * model. Today it is — the DM shows it as fully downloaded, but loadModel() would
 * reject it as corrupted, so the user cannot transcribe and has no retry affordance.
 */
import RNFS from 'react-native-fs';
import { whisperService } from '../../../src/services/whisperService';

const exists = RNFS.exists as jest.Mock;
const readDir = RNFS.readDir as jest.Mock;

const MB = 1024 * 1024;

describe('interrupted whisper download must not surface as a completed model', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    exists.mockResolvedValue(true); // models dir exists
  });

  // BUG: a partial file is listed as a completed model. `it.failing` passes while the
  // bug exists and flips red once listDownloadedModels enforces a size/validity floor.
  it.failing('a 3MB partial ggml-base.en.bin (below the 10MB validity floor) is not "completed"', async () => {
    // The on-disk state after an app-kill mid base.en download: the final-named
    // file exists but is truncated well below the smallest real whisper model.
    readDir.mockResolvedValue([
      {
        name: 'ggml-base.en.bin',
        path: '/mock/documents/whisper-models/ggml-base.en.bin',
        size: 3 * MB, // truncated — real base.en is ~142MB
        isFile: () => true,
        isDirectory: () => false,
      },
    ]);

    const listed = await whisperService.listDownloadedModels();
    const partial = listed.find((m) => m.modelId === 'base.en');

    // TERMINAL ARTIFACT: a partial file must not be reported as a downloaded model.
    // (It fails whisperService's own validateModelFile 10MB floor, so listing it as
    // completed strands the user: the DM says "downloaded" but it can never load.)
    expect(partial).toBeUndefined();
  });

  // GREEN guard: a genuinely complete file IS listed (so a future size floor must not
  // over-reject real models). This one asserts correct, currently-holding behavior.
  it('a full-size ggml-base.en.bin is listed as a completed model', async () => {
    readDir.mockResolvedValue([
      {
        name: 'ggml-base.en.bin',
        path: '/mock/documents/whisper-models/ggml-base.en.bin',
        size: 142 * MB,
        isFile: () => true,
        isDirectory: () => false,
      },
    ]);
    const listed = await whisperService.listDownloadedModels();
    expect(listed.find((m) => m.modelId === 'base.en')?.sizeBytes).toBe(142 * MB);
  });
});
