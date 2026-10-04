/**
 * RED-FLOW (integration) — NEW (found by the swallow-then-succeed pattern hunt, not in PR#452/453/454):
 * generation-sidecar reclaim over-commits when the transcription unload fails.
 *
 * On a memory-tight device the generation hot path reclaims idle STT via
 * the transcription resident must stay in the budget map if its native unload REJECTS (still holding
 * ~320MB). The subsequent LLM+TTS load then sizes against phantom-freed RAM → OOM. Same class as PR#454
 * but on the transcription-reclaim path. Real modelResidencyManager over the RAM
 * stub; only the native unload is faked (made to reject).
 */
import { modelResidencyManager } from '../../harness/activeModelLifecycle';
import { setDeviceMemory, resetDeviceMemory, gbOf } from '../../harness/deviceMemory';

afterEach(async () => resetDeviceMemory());

describe('STT reclaim — failed whisper unload over-commits (red-flow)', () => {
  it('keeps whisper resident when its unload rejects (does not count it as freed)', async () => {
    await setDeviceMemory({ platform: 'android', totalGB: 4, availGB: gbOf(500) }); // ≤6GB → reclaim path active
    const unload = jest.fn().mockResolvedValue(undefined);
    const lease = await modelResidencyManager.acquire(
      { key: 'whisper', type: 'transcription', modelId: 'base.en', sizeMB: 320, canEvict: () => true },
      { load: async () => undefined, unload },
    );
    await lease.release();
    unload.mockRejectedValue(new Error('native whisper unload failed'));

    await modelResidencyManager.reclaim({
      id: 'generation-sidecar-reclaim',
      maximumTotalMemoryMB: 6 * 1024,
      modalities: ['transcription'],
    });

    // Correct: the unload failed, so whisper still holds its RAM — it must stay counted resident, or the
    // next LLM+TTS load sizes against phantom-freed memory → OOM. Today it's deleted regardless → RED.
    expect(modelResidencyManager.isResident('whisper')).toBe(true);
  });
});
