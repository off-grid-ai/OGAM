import { BargeInDetector } from '../../../src/atlasVoice/bargeIn';

const feed = (d: BargeInDetector, frames: number[]) => frames.map(f => d.push(f));

describe('BargeInDetector', () => {
  it('ignores the steady echo of the spoken answer', () => {
    const d = new BargeInDetector();
    expect(feed(d, Array(40).fill(0).map((_, i) => 0.05 + (i % 3) * 0.01)).some(Boolean)).toBe(false);
  });

  it('triggers when the user talks clearly over the answer for ~0.3 s', () => {
    const d = new BargeInDetector();
    feed(d, Array(10).fill(0.04));
    expect(feed(d, [0.25, 0.3])).toEqual([false, false]);
    expect(d.push(0.28)).toBe(true);
  });

  it('does not trigger on a short click or cough', () => {
    const d = new BargeInDetector();
    feed(d, Array(10).fill(0.04));
    expect(feed(d, [0.4, 0.04, 0.4, 0.04, 0.4]).some(Boolean)).toBe(false);
  });

  it('needs more than a quiet whisper over silence (absolute floor)', () => {
    const d = new BargeInDetector();
    feed(d, Array(10).fill(0.002));
    expect(feed(d, [0.03, 0.03, 0.03, 0.03]).some(Boolean)).toBe(false);
  });

  it('adapts to a loud loudspeaker echo', () => {
    const d = new BargeInDetector();
    feed(d, Array(10).fill(0.12));
    // Loudspeaker echo at 0.12: something only somewhat louder is not a person over it...
    expect(feed(d, [0.2, 0.2, 0.2, 0.2]).some(Boolean)).toBe(false);
    // ...it raises the echo estimate to 0.2, so a voice must now pass 0.5.
    expect(feed(d, [0.6, 0.6, 0.6]).pop()).toBe(true);
  });

  it('ignores the first frames while playback starts', () => {
    const d = new BargeInDetector();
    expect(feed(d, [0.5, 0.5, 0.5]).some(Boolean)).toBe(false);
  });
});
