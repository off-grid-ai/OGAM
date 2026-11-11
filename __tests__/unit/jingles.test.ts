import { makeJingle, wavBytes, toBase64, jingleSeconds, SCORES, JINGLE_PEAK, type JingleKind } from '../../src/atlasVoice/jingles';

const KINDS: JingleKind[] = ['intro', 'outro', 'chime'];

describe('jingles', () => {
  it('have sensible lengths: intro and outro a couple of seconds, the chime short', () => {
    expect(jingleSeconds('intro')).toBeGreaterThan(1.5);
    expect(jingleSeconds('intro')).toBeLessThan(3.5);
    expect(jingleSeconds('outro')).toBeLessThan(3.5);
    expect(jingleSeconds('chime')).toBeLessThan(1);
  });
  it('make audible but not clipped sound that fades to silence', () => {
    for (const k of KINDS) {
      const s = makeJingle(k);
      const peak = s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak).toBeGreaterThan(8000);
      expect(peak).toBeLessThan(0.6 * 32767);
      expect(Math.abs(s[s.length - 1])).toBeLessThan(200);
    }
  });
  it('play every note of the score', () => {
    for (const k of KINDS) expect(SCORES[k].every((x) => x.hz > 0)).toBe(true);
  });
  it('write a valid WAV header', () => {
    const wav = wavBytes(makeJingle('chime'));
    const text = (a: number, b: number) => String.fromCharCode(...wav.slice(a, b));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 12)).toBe('WAVE');
    expect(text(36, 40)).toBe('data');
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(wav.length - 44);
  });
  it('encode base64 like the standard', () => {
    const enc = (s: string) => toBase64(Uint8Array.from(Buffer.from(s)));
    for (const s of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) expect(enc(s)).toBe(Buffer.from(s).toString('base64'));
  });
  it('come in three volumes, each louder than the one before and none clipped', () => {
    const peak = (v: keyof typeof JINGLE_PEAK) => makeJingle('chime', undefined, JINGLE_PEAK[v]).reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(peak('quiet')).toBeLessThan(peak('normal'));
    expect(peak('normal')).toBeLessThan(peak('loud'));
    expect(peak('loud')).toBeLessThan(32767 * 0.9);
  });
});
