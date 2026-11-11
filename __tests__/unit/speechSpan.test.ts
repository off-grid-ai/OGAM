import { speechSpan } from '../../src/atlasVoice/podcastAudio';

describe('trimming the silence around a rendered line', () => {
  it('starts just before the speech and stops just after it', () => {
    const rate = 1000;
    const samples = [...Array(300).fill(0), ...Array(400).fill(0.3), ...Array(500).fill(0.001)];
    const { offset, duration } = speechSpan(samples, rate);
    expect(offset).toBeCloseTo(0.27, 2);
    expect(offset + duration).toBeCloseTo(0.78, 2);
  });
  it('plays a silent file whole', () => {
    expect(speechSpan(Array(500).fill(0), 1000)).toEqual({ offset: 0, duration: 0.5 });
  });
});
