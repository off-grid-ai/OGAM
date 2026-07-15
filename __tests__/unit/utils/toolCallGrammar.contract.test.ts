import {
  TOOL_CALL_OPENERS,
  TOOL_CALL_CLOSERS,
  stripControlTokens,
} from '@offgrid/core/utils/messageContent';
import { ToolCallTokenFilter } from '../../../src/services/llmToolGeneration';

/**
 * Contract: the Gemma-native tool-call grammar (TOOL_CALL_OPENERS/CLOSERS) is the SINGLE source,
 * and BOTH consumers honour EVERY opener × closer combination:
 *   - stripControlTokens — removes the block from stored/rendered content
 *   - ToolCallTokenFilter — suppresses it live from the visible stream
 * DR7 was the drift where the parser accepted `<tool_call:` but the filter/stripper knew only
 * `<|tool_call>`, so the colon form leaked as visible text. This fails the instant an opener or
 * closer is added to the grammar but not handled by either consumer — they can never drift again.
 */
describe('tool-call grammar — single source, stripper and stream filter agree', () => {
  // Every opener paired with every closer — the full matrix the grammar allows.
  const combos = TOOL_CALL_OPENERS.flatMap(open =>
    TOOL_CALL_CLOSERS.map(close => ({ open, close })),
  );

  const RESIDUAL = /<\|?tool_call[>:|]|<\/tool_call>|<tool_call\|>/;

  it.each(combos)(
    'stripControlTokens removes a block opened by %o',
    ({ open, close }) => {
      const raw = `answer before ${open}call:get_weather{"city":"NYC"}${close} answer after`;
      const stripped = stripControlTokens(raw);
      expect(stripped).not.toMatch(RESIDUAL);
      expect(stripped).toContain('answer before');
      expect(stripped).toContain('answer after');
    },
  );

  it.each(combos)(
    'ToolCallTokenFilter suppresses a block opened by %o (whole token)',
    ({ open, close }) => {
      const filter = new ToolCallTokenFilter();
      const out = filter.process(`visible ${open}payload${close} tail`);
      expect(out).not.toMatch(RESIDUAL);
      expect(out).toContain('visible');
      expect(out).toContain('tail');
    },
  );

  it.each(combos)(
    'ToolCallTokenFilter suppresses a block opened by %o split char-by-char',
    ({ open, close }) => {
      const full = `visible ${open}payload${close}tail`;
      const filter = new ToolCallTokenFilter();
      let out = '';
      for (const ch of full) out += filter.process(ch);
      expect(out).not.toMatch(RESIDUAL);
      expect(out).toBe('visible tail');
    },
  );

  // The exact DR7 regression: the colon opener the Gemma parser accepts must not leak.
  it('strips the Gemma colon opener <tool_call: that used to leak (DR7)', () => {
    const raw = 'Sure.<tool_call:get_weather{"city":"NYC"}<tool_call|>';
    expect(stripControlTokens(raw)).toBe('Sure.');
  });

  it('strips an UNCLOSED tool-call opener at end of stored content (EOS mid-call)', () => {
    expect(
      stripControlTokens('Working on it.<tool_call:get_weather{"city":"NY'),
    ).toBe('Working on it.');
    expect(stripControlTokens('Working on it.<|tool_call>call:x{')).toBe(
      'Working on it.',
    );
  });
});
