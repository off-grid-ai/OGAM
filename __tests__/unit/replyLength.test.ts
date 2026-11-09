import { autoReplyTokens, resolveReplyTokens, contextOutputReserve } from '../../src/services/contextWindow';
import { buildCompletionParams } from '../../src/services/llmHelpers';

describe('automatic reply length', () => {
  it('follows the memory window within limits', () => {
    expect(autoReplyTokens(2048)).toBe(1024); // never below 1K
    expect(autoReplyTokens(4096)).toBe(1638);
    expect(autoReplyTokens(16384)).toBe(6553);
    expect(autoReplyTokens(65536)).toBe(8192); // never above 8K
  });
  it('never asks for more than the prompt guard will keep free', () => {
    for (const ctx of [4096, 8192, 16384, 32768]) {
      expect(contextOutputReserve(ctx, autoReplyTokens(ctx))).toBe(autoReplyTokens(ctx));
    }
  });
  it('uses the chosen number when manual', () => {
    expect(resolveReplyTokens({ maxTokens: 700, maxTokensMode: 'manual' }, 16384)).toBe(700);
  });
  it('is automatic when nothing was chosen (older saved settings)', () => {
    expect(resolveReplyTokens({ maxTokens: 1024 }, 8192)).toBe(3276);
  });
  it('falls back to the number when the window size is unknown', () => {
    expect(resolveReplyTokens({ maxTokens: 1024, maxTokensMode: 'auto' })).toBe(1024);
  });
  it('is what the model is asked for', () => {
    expect(buildCompletionParams({ maxTokens: 1024, maxTokensMode: 'auto' }, { contextLength: 8192 }).n_predict).toBe(3276);
    expect(buildCompletionParams({ maxTokens: 1024, maxTokensMode: 'manual' }, { contextLength: 8192 }).n_predict).toBe(1024);
  });
});
