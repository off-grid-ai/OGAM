import { judgeAnswer, judgeConfidence, judgeText, type SampledToken } from '../../src/services/outputHealth';

// The three GPU replies from the phone's own test report that the first version of the check let through or caught.
const tok = (piece: string, id: number, p: number): SampledToken => ({ piece, id, topProbability: p });

describe('output check, judged on what the phone actually produced', () => {
  it('rejects a reply whose first token has NaN scores, though the rest reads fine (OpenCL, 24 and 16 layers)', () => {
    const tokens = [tok('<pad>', 0, NaN), tok('!', 236888, 0.29), tok(' How', 2088, 0.83), tok(' can', 740, 1), tok(' I', 564, 1), tok(' help', 1601, 1)];
    expect(judgeText('<pad>! How can I help you today?')).toBe(''); // one placeholder is not "mostly placeholders"
    expect(judgeConfidence(tokens)).toMatch(/scores were not numbers \(NaN\) for 1 of 6 tokens/);
  });

  it('rejects a reply that opens with a placeholder token even if every score is a number', () => {
    const tokens = [tok('<pad>', 0, 0.4), tok('12', 2, 0.9)];
    expect(judgeAnswer('<pad>12', tokens)).toMatch(/first word was a placeholder token \(<pad>\)/);
  });

  it('rejects a wrong first word that leads to a fluent but unrelated reply ("ASU is a great choice", OpenCL 8 layers)', () => {
    const tokens = [tok('▁', 258882, 0.85), tok('ASU', 563, 0.37), tok(' is', 496, 0.53)];
    expect(judgeConfidence(tokens)).toBe('');
    expect(judgeAnswer(' ASU is a great choice! To give you the best information', tokens)).toMatch(/did not answer "7 plus 5"/);
  });

  it('accepts the right answer in any ordinary wording, and an empty reply is inconclusive rather than a failure', () => {
    const ok = [tok('12', 1, 0.99)];
    expect(judgeAnswer('12', ok)).toBe('');
    expect(judgeAnswer('The answer is 12.', ok)).toBe('');
    expect(judgeAnswer('Twelve', ok)).toBe('');
    expect(judgeAnswer('', [])).toBe('');
  });
});
