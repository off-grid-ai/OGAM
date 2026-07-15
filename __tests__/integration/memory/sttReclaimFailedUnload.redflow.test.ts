/**
 * RED-FLOW (integration) — NEW (found by the swallow-then-succeed pattern hunt, not in PR#452/453/454):
 * reclaimSttForGeneration over-commits when the whisper unload fails.
 *
 * On a memory-tight device the generation hot path reclaims idle STT via
 * `await w.unload().catch(log); this.residents.delete('whisper')` (modelResidency/index.ts:482-485) —
 * the whisper resident is deleted from the budget map even if its native unload REJECTED (still holding
 * ~320MB). The subsequent LLM+TTS load then sizes against phantom-freed RAM → OOM. Same class as PR#454
 * but on the STT-reclaim path (PR#454 only fixed makeRoomFor). Real modelResidencyManager over the RAM
 * stub; only the native unload is faked (made to reject).
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { setDeviceMemory, resetDeviceMemory, makeResident, gbOf } from '../../harness/deviceMemory';

afterEach(() => resetDeviceMemory());

describe('STT reclaim — failed whisper unload over-commits (red-flow)', () => {
  it('keeps whisper resident when its unload rejects (does not count it as freed)', async () => {
    setDeviceMemory({ platform: 'android', totalGB: 4, availGB: gbOf(500) }); // ≤6GB → reclaim path active
    const unload = makeResident({ key: 'whisper', type: 'stt', modelId: 'base.en', sizeMB: 320, canEvict: () => true });
    unload.mockRejectedValue(new Error('native whisper unload failed'));

    await modelResidencyManager.reclaimSttForGeneration();

    // Correct: the unload failed, so whisper still holds its RAM — it must stay counted resident, or the
    // next LLM+TTS load sizes against phantom-freed memory → OOM. Today it's deleted regardless → RED.
    expect(modelResidencyManager.isResident('whisper')).toBe(true);
  });
});
