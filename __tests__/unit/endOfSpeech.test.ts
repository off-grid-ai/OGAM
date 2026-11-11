import { EndOfSpeechDetector } from '../../src/atlasVoice/endOfSpeech';

const feed = (d: EndOfSpeechDetector, levels: number[], stepMs: number, from = 0) =>
  levels.map((rms, i) => d.push(rms, from + i * stepMs));

describe('end of speech', () => {
  it('ends the turn after a second of quiet that follows speech', () => {
    const d = new EndOfSpeechDetector(0);
    const quiet = Array(4).fill(0.005);
    const speech = Array(10).fill(0.2);
    const after = Array(15).fill(0.004);
    const out = feed(d, [...quiet, ...speech, ...after], 100);
    expect(out.indexOf('end')).toBeGreaterThan(14); // not before speech + 1 s of quiet
    expect(out.filter((v) => v === 'end')).toHaveLength(1);
    expect(d.push(0.004, 99999)).toBe('none'); // decided once
  });

  it('does not end while the person is still talking, even through short pauses', () => {
    const d = new EndOfSpeechDetector(0);
    const levels = [...Array(4).fill(0.005), ...Array(5).fill(0.2), ...Array(6).fill(0.004), ...Array(5).fill(0.2), ...Array(6).fill(0.004)];
    expect(feed(d, levels, 100)).not.toContain('end');
  });

  it('gives up when nobody speaks, and reports a recording with no levels', () => {
    const d = new EndOfSpeechDetector(0, { silenceMs: 1000, noSpeechMs: 2000, maxTurnMs: 60000 });
    const out = feed(d, Array(40).fill(0.004), 100);
    expect(out).toContain('nothing');
    expect(new EndOfSpeechDetector(0).levels).toBe(0);
  });

  it('ends a turn that runs too long', () => {
    const d = new EndOfSpeechDetector(0, { silenceMs: 1000, noSpeechMs: 15000, maxTurnMs: 3000 });
    const out = feed(d, [...Array(4).fill(0.005), ...Array(60).fill(0.2)], 100);
    expect(out).toContain('end');
  });

  it('still ends the turn when the person starts talking at once, before the room has been measured', () => {
    const d = new EndOfSpeechDetector(0);
    const out = feed(d, [...Array(3).fill(0.12), 0.004, ...Array(8).fill(0.12), ...Array(15).fill(0.004)], 100);
    expect(out).toContain('end');
  });

  it('ends the turn in a room with a steady hum', () => {
    const d = new EndOfSpeechDetector(0);
    const out = feed(d, [...Array(4).fill(0.03), ...Array(8).fill(0.2), ...Array(15).fill(0.03)], 100);
    expect(out).toContain('end');
  });
});
