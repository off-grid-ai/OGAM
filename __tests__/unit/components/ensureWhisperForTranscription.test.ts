import { ensureWhisperForTranscription } from '../../../src/components/ChatInput/ensureWhisperForTranscription';

/**
 * Guards the 🟠 Major fix: transcription must free a blocking generation model ONLY
 * when whisper was BLOCKED by the single-model rule — never on a hard whisper-load
 * failure. Evicting the user's generation model for a whisper that can't load anyway
 * would strand them with nothing loaded. The old code called unloadAllModels on ANY
 * non-load, so the 'error' case below fails on it and passes with the fix.
 */
const makeDeps = (over: Partial<Parameters<typeof ensureWhisperForTranscription>[0]> = {}) => {
  const freeGenerationModels = jest.fn(async () => {});
  const loadWhisper = jest.fn(async () => 'loaded' as const);
  const deps = {
    isLoaded: () => false,
    hasDownloadedModel: () => true,
    loadWhisper,
    freeGenerationModels,
    ...over,
  };
  return { deps, freeGenerationModels, loadWhisper };
};

describe('ensureWhisperForTranscription', () => {
  it('returns true immediately when whisper is already loaded (no load, no eviction)', async () => {
    const { deps, freeGenerationModels, loadWhisper } = makeDeps({ isLoaded: () => true });
    await expect(ensureWhisperForTranscription(deps)).resolves.toBe(true);
    expect(loadWhisper).not.toHaveBeenCalled();
    expect(freeGenerationModels).not.toHaveBeenCalled();
  });

  it('returns false when no model is downloaded (no eviction)', async () => {
    const { deps, freeGenerationModels, loadWhisper } = makeDeps({ hasDownloadedModel: () => false });
    await expect(ensureWhisperForTranscription(deps)).resolves.toBe(false);
    expect(loadWhisper).not.toHaveBeenCalled();
    expect(freeGenerationModels).not.toHaveBeenCalled();
  });

  it('loads normally when there is room — does NOT evict any generation model', async () => {
    const { deps, freeGenerationModels } = makeDeps({ loadWhisper: jest.fn(async () => 'loaded' as const) });
    await expect(ensureWhisperForTranscription(deps)).resolves.toBe(true);
    expect(freeGenerationModels).not.toHaveBeenCalled();
  });

  it('does NOT evict the generation model on a hard whisper-load ERROR (the regression)', async () => {
    const loadWhisper = jest.fn(async () => 'error' as const);
    const { deps, freeGenerationModels } = makeDeps({ loadWhisper });
    await expect(ensureWhisperForTranscription(deps)).resolves.toBe(false);
    // The whole point: a corrupt/missing whisper won't load, so evicting the user's
    // generation model would strand them. freeGenerationModels must NOT be called.
    expect(freeGenerationModels).not.toHaveBeenCalled();
    expect(loadWhisper).toHaveBeenCalledTimes(1); // no pointless retry either
  });

  it('frees the generation model and retries ONLY when blocked, then loads', async () => {
    const loadWhisper = jest.fn()
      .mockResolvedValueOnce('blocked')
      .mockResolvedValueOnce('loaded');
    const { deps, freeGenerationModels } = makeDeps({ loadWhisper });
    await expect(ensureWhisperForTranscription(deps)).resolves.toBe(true);
    expect(freeGenerationModels).toHaveBeenCalledTimes(1);
    expect(loadWhisper).toHaveBeenCalledTimes(2);
  });

  it('returns false when it is still blocked/failing after freeing (no infinite retry)', async () => {
    const loadWhisper = jest.fn()
      .mockResolvedValueOnce('blocked')
      .mockResolvedValueOnce('error');
    const { deps, freeGenerationModels } = makeDeps({ loadWhisper });
    await expect(ensureWhisperForTranscription(deps)).resolves.toBe(false);
    expect(freeGenerationModels).toHaveBeenCalledTimes(1);
    expect(loadWhisper).toHaveBeenCalledTimes(2);
  });
});
