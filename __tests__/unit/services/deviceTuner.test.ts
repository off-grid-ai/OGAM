import { pickBest, tuneOptions, type TuneResult } from '../../../src/services/deviceTuner';
import { shouldSuggestTuning } from '../../../src/atlasTools/speed';

const result = (id: string, threads: number, tps: number, error?: string): TuneResult =>
  ({ option: { id, label: id, backend: 'cpu' as any, threads }, tps, firstWordSec: 1, error });

describe('finding the best settings', () => {
  it('tries automatic acceleration, then the CPU with the recommended, fewer and a couple more threads', () => {
    expect(tuneOptions(8, 4).map((o) => o.id)).toEqual(['auto', 'cpu-4', 'cpu-3', 'cpu-6']);
    expect(tuneOptions(8, 6).map((o) => o.id)).toEqual(['auto', 'cpu-6', 'cpu-4', 'cpu-8']);
    expect(tuneOptions(4, 4).map((o) => o.id)).toEqual(['auto', 'cpu-4', 'cpu-3']);
    expect(tuneOptions(2, 2).map((o) => o.id)).toEqual(['auto', 'cpu-2']);
  });

  it('keeps the fastest, and with a near tie the one with fewer threads', () => {
    expect(pickBest([result('a', 4, 4.5), result('b', 6, 3.7), result('c', 8, 2.1)])?.option.id).toBe('a');
    expect(pickBest([result('a', 6, 4.6), result('b', 4, 4.5)])?.option.id).toBe('b');
    expect(pickBest([result('a', 6, 5.5), result('b', 4, 4.5)])?.option.id).toBe('a');
  });

  it('ignores options that failed, and picks nothing when none worked', () => {
    expect(pickBest([result('a', 4, 9, 'out of memory'), result('b', 4, 2)])?.option.id).toBe('b');
    expect(pickBest([result('a', 4, 0, 'failed')])).toBeNull();
    expect(pickBest([])).toBeNull();
  });

  it('suggests tuning only for a local model that is slow on at least two replies and not tuned or dismissed', () => {
    const slow = { decode: 2.1, prefill: 0, outLen: 100, samples: 2 };
    const base = { modelId: 'm', speed: slow, tuned: false, dismissed: false };
    expect(shouldSuggestTuning(base)).toBe(true);
    expect(shouldSuggestTuning({ ...base, speed: { ...slow, samples: 1 } })).toBe(false);
    expect(shouldSuggestTuning({ ...base, speed: { ...slow, decode: 4.5 } })).toBe(false);
    expect(shouldSuggestTuning({ ...base, tuned: true })).toBe(false);
    expect(shouldSuggestTuning({ ...base, dismissed: true })).toBe(false);
    expect(shouldSuggestTuning({ ...base, modelId: null })).toBe(false);
  });
});
