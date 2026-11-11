import { fitMessagesToContext } from '../../src/services/contextWindow';
import { longMessageText } from '../../src/services/longMessageNotice';

const tokens = async (t: string) => Math.ceil(t.length / 4);

describe('a message longer than the model can read', () => {
  it('is reported with its size, so the person is told it was cut', async () => {
    const long = 'word '.repeat(4000); // about 5,000 tokens
    const r = await fitMessagesToContext({
      messages: [{ role: 'system', content: 'Be helpful.' }, { role: 'user', content: long }],
      contextTokens: 2048, outputTokens: 512, format: (m) => m.map((x) => x.content).join('\n'), countTokens: tokens,
    });
    expect(r.latestTruncated).toBe(true);
    expect(r.latestTokens).toBeGreaterThan(r.budgetTokens);
  });
  it('is not reported when it fits', async () => {
    const r = await fitMessagesToContext({
      messages: [{ role: 'user', content: 'short question' }],
      contextTokens: 4096, outputTokens: 512, format: (m) => m.map((x) => x.content).join('\n'), countTokens: tokens,
    });
    expect(r.latestTruncated).toBe(false);
    expect(r.latestTokens).toBeUndefined();
  });
  it('says what was cut and what to do', () => {
    const t = longMessageText(12340, 1520);
    expect(t).toContain('12,300 tokens');
    expect(t).toContain('1,500');
    expect(t).toMatch(/start of it was left out/);
    expect(t).toMatch(/memory size/);
    expect(t).toMatch(/document/);
  });
});
