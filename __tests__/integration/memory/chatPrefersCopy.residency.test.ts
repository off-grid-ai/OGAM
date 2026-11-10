/**
 * Residency for an Android chat model, which runs fastest copied into memory and loads mapped when a
 * copy will not fit (spec.prefersCopy).
 *
 * The real modelResidencyManager decides; only the RAM sensor is faked (deviceMemory harness).
 * Product rules pinned:
 *  - Eviction makes room for the copy in real free RAM: a mapped model (speech to text) is unloaded
 *    when that is what lets the chat model load at full speed, though both fit the physical budget.
 *  - The chat model is never refused on the budget: K2 Horizon 3.7B (about 4.9 GB with its KV cache)
 *    on a 7 GB phone loads (mapped) instead of asking for Load Anyway. 0.0.122: 60 of 83 people
 *    refused this way loaded the same model with Load Anyway, and it worked.
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { setDeviceMemory, resetDeviceMemory, makeResident } from '../../harness/deviceMemory';

const SEVEN_GB_ANDROID = { platform: 'android' as const, totalGB: 7.3 };
const chat = (sizeMB: number, prefersCopy: boolean) =>
  ({ key: 'text', type: 'text' as const, modelId: 'k2', sizeMB, dirtyMemory: false, prefersCopy });

afterEach(() => resetDeviceMemory());

describe('an Android chat model that prefers a copy', () => {
  // A mapped model (speech to text) is charged only against physical RAM, so before this the chat
  // model's copy landed on top of it whatever was free.
  it('unloads a mapped model when that lets the copy fit in free RAM', async () => {
    await setDeviceMemory({ ...SEVEN_GB_ANDROID, availGB: 3.5 });
    const whisperUnload = makeResident({ key: 'whisper', type: 'whisper', sizeMB: 800 });

    const room = await modelResidencyManager.makeRoomFor(chat(3000, true));

    expect(room.fits).toBe(true);
    expect(whisperUnload).toHaveBeenCalled();
  });

  it('a chat model that is mapped anyway keeps today\'s plan: both fit physical RAM, so speech to text stays', async () => {
    await setDeviceMemory({ ...SEVEN_GB_ANDROID, availGB: 3.5 });
    const whisperUnload = makeResident({ key: 'whisper', type: 'whisper', sizeMB: 800 });

    const room = await modelResidencyManager.makeRoomFor(chat(3000, false));

    expect(room.fits).toBe(true);
    expect(whisperUnload).not.toHaveBeenCalled();
  });

  it('is never refused on the budget: everything else unloads and it loads mapped', async () => {
    await setDeviceMemory({ ...SEVEN_GB_ANDROID, availGB: 1.9 });
    const imageUnload = makeResident({ key: 'image', type: 'image', sizeMB: 1500, dirtyMemory: true });

    const room = await modelResidencyManager.makeRoomFor(chat(4854, true));

    expect(room.fits).toBe(true);
    expect(imageUnload).toHaveBeenCalled();
  });

  it('a model that died loading as a copy (starts mapped) unloads nothing for a copy, and is still not refused', async () => {
    await setDeviceMemory({ ...SEVEN_GB_ANDROID, availGB: 3.5 });
    const whisperUnload = makeResident({ key: 'whisper', type: 'whisper', sizeMB: 800 });
    const room = await modelResidencyManager.makeRoomFor({ ...chat(3000, true), startsMapped: true });
    expect(room.fits).toBe(true);
    expect(whisperUnload).not.toHaveBeenCalled();

    // Past the budget it is still admitted (it loads mapped); only the fit rule's Too big refuses it.
    const big = await modelResidencyManager.makeRoomFor({ ...chat(4854, true), startsMapped: true });
    expect(big.fits).toBe(true);
  });
});
