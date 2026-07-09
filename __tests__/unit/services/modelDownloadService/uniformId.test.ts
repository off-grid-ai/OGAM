/**
 * uniformDownloadId — the single rule both the providers' list() and the Download
 * Manager's action dispatch derive the routing id from. If these two ever disagree,
 * cancel/retry/remove silently no-op (`[DL-SM] … REFUSED: not found`). The STT case
 * is the one that regressed: store rows are `whisper-<id>`, the canonical id is bare.
 */
import { uniformDownloadId } from '../../../../src/services/modelDownloadService/uniformId';
import { isModelDownloadInProgress } from '../../../../src/services/modelDownloadService/storeStatus';

describe('isModelDownloadInProgress (service-vocab "active" predicate)', () => {
  it('is true for queued / downloading / paused (all non-terminal states)', () => {
    expect(isModelDownloadInProgress('queued')).toBe(true);
    expect(isModelDownloadInProgress('downloading')).toBe(true);
    expect(isModelDownloadInProgress('paused')).toBe(true);
  });

  it('is false for completed / error', () => {
    expect(isModelDownloadInProgress('completed')).toBe(false);
    expect(isModelDownloadInProgress('error')).toBe(false);
  });

  it('catches what a bare `=== "downloading"` check missed (queued, paused)', () => {
    // The VoiceModelsPanel regression: a queued or kill-interrupted (paused) TTS
    // download rendered as the idle CTA because it only matched 'downloading'.
    const bare = (s: string) => s === 'downloading';
    expect(isModelDownloadInProgress('queued')).toBe(true);
    expect(bare('queued')).toBe(false);
    expect(isModelDownloadInProgress('paused')).toBe(true);
    expect(bare('paused')).toBe(false);
  });
});

describe('uniformDownloadId', () => {
  it('strips the whisper- prefix for STT so it matches whisperService\'s bare id', () => {
    expect(uniformDownloadId('stt', 'whisper-medium.en')).toBe('stt:medium.en');
    expect(uniformDownloadId('stt', 'whisper-small.en')).toBe('stt:small.en');
  });

  it('leaves an already-bare STT id unchanged (idempotent)', () => {
    expect(uniformDownloadId('stt', 'medium.en')).toBe('stt:medium.en');
  });

  it('strips the image: prefix so the View (bare id) and provider (prefixed store id) agree', () => {
    // Provider lists from the store row whose modelId is `image:<id>`; the View's
    // DownloadItem carries the already-bare id. Both must resolve to the same routing id.
    expect(uniformDownloadId('image', 'image:coreml_sdxl')).toBe('image:coreml_sdxl');
    expect(uniformDownloadId('image', 'coreml_sdxl')).toBe('image:coreml_sdxl');
  });

  it('passes text / tts model ids through unchanged', () => {
    expect(uniformDownloadId('text', 'unsloth/gemma-4-E2B-it-GGUF')).toBe('text:unsloth/gemma-4-E2B-it-GGUF');
    expect(uniformDownloadId('tts', 'kokoro')).toBe('tts:kokoro');
  });
});
