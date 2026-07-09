import {
  REASONING_DELIMITERS,
  parseThinkingContent,
} from '@offgrid/core/utils/messageContent';
import { ThinkTagParser } from '../../../src/services/providers/openAICompatibleStream';

/**
 * Contract: the reasoning delimiter grammar (REASONING_DELIMITERS) is the SINGLE source of truth
 * for what counts as reasoning, and BOTH parsers derive from it and AGREE:
 *   - parseThinkingContent — the complete-string parser (finalize + render)
 *   - ThinkTagParser        — the incremental streaming parser (remote providers)
 * The DR1 bug was these disagreeing: the streaming parser knew only <think> and leaked
 * Gemma/Qwen channel reasoning into the visible answer. This test fails the moment a format
 * is added to the grammar but not honoured by either parser — so they can never drift again.
 */
describe('reasoning grammar — single source, both parsers agree', () => {
  const REASONING = 'the private reasoning';
  const ANSWER = 'the visible answer';

  it.each(REASONING_DELIMITERS)(
    'complete-string parseThinkingContent splits format opened by %j',
    ({ open, close }) => {
      const raw = `${open}${REASONING}${close}${ANSWER}`;
      const parsed = parseThinkingContent(raw);
      expect(parsed.thinking).toBe(REASONING);
      expect(parsed.response).toBe(ANSWER);
      expect(parsed.isThinkingComplete).toBe(true);
      // The answer never carries the opener/closer markup.
      expect(parsed.response).not.toContain(open.trim());
      expect(parsed.response).not.toContain(close.trim());
    },
  );

  it.each(REASONING_DELIMITERS)(
    'streaming ThinkTagParser routes reasoning of format opened by %j to onReasoning, answer to onToken',
    ({ open, close }) => {
      const parser = new ThinkTagParser();
      const tokens: string[] = [];
      const reasoning: string[] = [];
      parser.process(`${open}${REASONING}${close}${ANSWER}`, (t) => tokens.push(t), (r) => reasoning.push(r));
      expect(reasoning.join('')).toBe(REASONING);
      expect(tokens.join('')).toBe(ANSWER);
    },
  );

  it.each(REASONING_DELIMITERS)(
    'streaming parser handles format %j split arbitrarily across chunks',
    ({ open, close }) => {
      const full = `${open}${REASONING}${close}${ANSWER}`;
      const parser = new ThinkTagParser();
      const tokens: string[] = [];
      const reasoning: string[] = [];
      // Feed one character at a time — the worst case for tag-straddling chunks.
      for (const ch of full) {
        parser.process(ch, (t) => tokens.push(t), (r) => reasoning.push(r));
      }
      expect(reasoning.join('')).toBe(REASONING);
      expect(tokens.join('')).toBe(ANSWER);
    },
  );
});
