// Drives the REAL ensureWhisperForTranscription through the locket wrapper; only
// the boundaries (whisper service/store, activeModelService) are mocked. Asserts
// the OUTCOME of the single-model dance, not that a function was called.
jest.mock('@offgrid/core/services', () => ({
  whisperService: { isModelLoaded: jest.fn(() => false) },
  activeModelService: { unloadAllModels: jest.fn(async () => ({})) },
}));
jest.mock('@offgrid/core/stores', () => ({
  useWhisperStore: { getState: jest.fn() },
}));

import { ensureWhisperReady } from '../../../pro/locket/utils/ensureWhisperReady';
import { whisperService, activeModelService } from '@offgrid/core/services';
import { useWhisperStore } from '@offgrid/core/stores';

const isLoaded = whisperService.isModelLoaded as jest.Mock;
const unloadAll = activeModelService.unloadAllModels as jest.Mock;
const getState = useWhisperStore.getState as unknown as jest.Mock;

function whisper(downloadedModelId: string | null, loadModel: jest.Mock) {
  getState.mockReturnValue({ downloadedModelId, loadModel });
}

beforeEach(() => {
  jest.clearAllMocks();
  isLoaded.mockReturnValue(false);
});

it('loads directly and does NOT free anything when not blocked', async () => {
  const loadModel = jest.fn(async () => 'loaded');
  whisper('ggml-base', loadModel);
  await expect(ensureWhisperReady({ useGpu: true })).resolves.toBe(true);
  expect(unloadAll).not.toHaveBeenCalled();
});

it('frees the generation model and retries when blocked, then loads', async () => {
  const loadModel = jest.fn().mockResolvedValueOnce('blocked').mockResolvedValueOnce('loaded');
  whisper('ggml-base', loadModel);
  await expect(ensureWhisperReady()).resolves.toBe(true);
  expect(unloadAll).toHaveBeenCalledWith(true);
  expect(loadModel).toHaveBeenCalledTimes(2);
});

it('returns false when still blocked after freeing (no room even after eviction)', async () => {
  const loadModel = jest.fn().mockResolvedValue('blocked');
  whisper('ggml-base', loadModel);
  await expect(ensureWhisperReady()).resolves.toBe(false);
  expect(unloadAll).toHaveBeenCalledTimes(1);
});

it('a hard error does NOT evict the generation model (whisper is broken, not blocked)', async () => {
  const loadModel = jest.fn(async () => 'error');
  whisper('ggml-base', loadModel);
  await expect(ensureWhisperReady()).resolves.toBe(false);
  expect(unloadAll).not.toHaveBeenCalled();
});

it('returns false and never loads when no whisper model is downloaded', async () => {
  const loadModel = jest.fn(async () => 'loaded');
  whisper(null, loadModel);
  await expect(ensureWhisperReady()).resolves.toBe(false);
  expect(loadModel).not.toHaveBeenCalled();
});

it('uses an already-loaded whisper without touching the generation model', async () => {
  isLoaded.mockReturnValue(true);
  const loadModel = jest.fn();
  whisper('ggml-base', loadModel);
  await expect(ensureWhisperReady()).resolves.toBe(true);
  expect(loadModel).not.toHaveBeenCalled();
  expect(unloadAll).not.toHaveBeenCalled();
});
