/**
 * Waveform helpers — pure functions that turn PCM / transcript text into
 * amplitude data for the message waveform UI.
 */
import { meanAbsAmplitude, waveformFromText, buildWaveformEnvelope } from '../../../pro/audio/engine/waveform';

describe('meanAbsAmplitude', () => {
  it('returns 0 for an empty buffer', () => {
    expect(meanAbsAmplitude(new Float32Array(0))).toBe(0);
  });

  it('averages absolute sample values', () => {
    expect(meanAbsAmplitude(new Float32Array([0.5, -0.5, 1, -1]))).toBeCloseTo(0.75, 5);
  });
});

describe('buildWaveformEnvelope', () => {
  it('returns [] for empty samples or non-positive points', () => {
    expect(buildWaveformEnvelope(new Float32Array(0), 10)).toEqual([]);
    expect(buildWaveformEnvelope(new Float32Array([1, 2, 3]), 0)).toEqual([]);
  });

  it('returns [] when there are fewer samples than points (blockSize 0)', () => {
    expect(buildWaveformEnvelope(new Float32Array([1, 2]), 8)).toEqual([]);
  });

  it('downsamples to exactly `points` buckets', () => {
    const samples = new Float32Array(100).fill(0.5);
    const env = buildWaveformEnvelope(samples, 10);
    expect(env).toHaveLength(10);
    env.forEach((v) => expect(v).toBeCloseTo(0.5, 5));
  });
});

describe('waveformFromText', () => {
  it('returns [] for blank text or non-positive points', () => {
    expect(waveformFromText('', 48)).toEqual([]);
    expect(waveformFromText('   \n  ', 48)).toEqual([]);
    expect(waveformFromText('hello', 0)).toEqual([]);
  });

  it('returns exactly `points` bars, all within [0, 1]', () => {
    const bars = waveformFromText('Hello, how can I help you today?', 48);
    expect(bars).toHaveLength(48);
    bars.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });

  it('is deterministic — same text yields the same bars', () => {
    const a = waveformFromText('The quick brown fox.', 32);
    const b = waveformFromText('The quick brown fox.', 32);
    expect(a).toEqual(b);
  });
});
