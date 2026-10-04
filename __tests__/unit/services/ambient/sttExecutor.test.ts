/**
 * The STT dispatch seam — tested through fake executors (real interface, fake impls) to prove the
 * routing AND the resilience contract: the Mac is an accelerator, never a hard dependency, so a
 * missing or failing Mac path degrades to on-device whisper instead of dropping the segment. This is
 * the DSP guard — a caller can swap either backend without the dispatcher changing.
 */

import {
  dispatchStt,
  type SttExecutor,
  type SttInput,
  type SttJob
} from '../../../../src/services/ambient/sttExecutor';

const INPUT: SttInput = { segmentId: 's1', recordingPath: '/rec.wav', startMs: 0, endMs: 900 };

/** A fake backend that records it was called and returns a fixed transcript. */
function fakeExecutor(text: string) {
  const calls: SttInput[] = [];
  const executor: SttExecutor = {
    transcribe: async (input) => {
      calls.push(input);
      return { text };
    }
  };
  return { executor, calls };
}

function throwingExecutor(message: string): SttExecutor {
  return {
    transcribe: async () => {
      throw new Error(message);
    }
  };
}

const phoneJob: SttJob = { segmentId: 's1', executor: 'phone' };
const macJob: SttJob = { segmentId: 's1', executor: 'mac' };

describe('dispatchStt', () => {
  it('runs a phone job on the phone backend', async () => {
    const phone = fakeExecutor('on-device text');
    const result = await dispatchStt(phoneJob, INPUT, { phone: phone.executor });
    expect(result).toEqual({ segmentId: 's1', ok: true, text: 'on-device text', executor: 'phone' });
    expect(phone.calls).toEqual([INPUT]);
  });

  it('runs a mac job on the mac backend when present', async () => {
    const phone = fakeExecutor('phone');
    const mac = fakeExecutor('mac text');
    const result = await dispatchStt(macJob, INPUT, { phone: phone.executor, mac: mac.executor });
    expect(result).toEqual({ segmentId: 's1', ok: true, text: 'mac text', executor: 'mac' });
    expect(mac.calls).toHaveLength(1);
    expect(phone.calls).toHaveLength(0);
  });

  it('falls back to the phone when the mac backend is absent (mesh unreachable)', async () => {
    const phone = fakeExecutor('phone text');
    const result = await dispatchStt(macJob, INPUT, { phone: phone.executor });
    expect(result).toEqual({ segmentId: 's1', ok: true, text: 'phone text', executor: 'phone' });
    expect(phone.calls).toHaveLength(1);
  });

  it('falls back to the phone when the mac backend throws (mesh dropped mid-run)', async () => {
    const phone = fakeExecutor('phone text');
    const result = await dispatchStt(macJob, INPUT, {
      phone: phone.executor,
      mac: throwingExecutor('connection reset')
    });
    expect(result).toEqual({ segmentId: 's1', ok: true, text: 'phone text', executor: 'phone' });
  });

  it('reports failure only when every backend fails', async () => {
    const result = await dispatchStt(macJob, INPUT, {
      phone: throwingExecutor('whisper OOM'),
      mac: throwingExecutor('connection reset')
    });
    expect(result).toEqual({ segmentId: 's1', ok: false, error: 'whisper OOM' });
  });

  it('surfaces the phone failure for a phone job', async () => {
    const result = await dispatchStt(phoneJob, INPUT, { phone: throwingExecutor('no model') });
    expect(result).toEqual({ segmentId: 's1', ok: false, error: 'no model' });
  });

  it('never touches the phone for a mac job that succeeds', async () => {
    const phone = fakeExecutor('phone');
    const mac = fakeExecutor('mac');
    await dispatchStt(macJob, INPUT, { phone: phone.executor, mac: mac.executor });
    expect(phone.calls).toHaveLength(0);
  });
});
