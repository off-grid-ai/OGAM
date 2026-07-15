import { parseModelOutput } from '../../../../src/components/ChatMessage/utils';
import {
  REASONING_DELIMITERS,
  TOOL_CALL_OPENERS,
  TOOL_CALL_CLOSERS,
} from '../../../../src/utils/messageContent';

// Contract: parseModelOutput().answer is GUARANTEED free of reasoning + tool-call markup for
// EVERY format the app can emit. The MARKUP matcher is DERIVED from the same single-source
// grammar the parser/stripper use (REASONING_DELIMITERS + TOOL_CALL_OPENERS/CLOSERS) plus the
// function-style tokens, so a new opener/closer added to the grammar is guarded automatically —
// the matcher can't silently drift out of sync with the parser (the exact class this PR kills).
const GRAMMAR_TOKENS = [
  ...REASONING_DELIMITERS.flatMap(d => [d.open, d.close]),
  ...TOOL_CALL_OPENERS,
  ...TOOL_CALL_CLOSERS,
  // Function-style tokens parsed by generationToolLoop but not part of the delimiter grammar.
  '<function=',
  '</function>',
  '<parameter=',
  '</parameter>',
  '<invoke',
  '<function_call>',
];
const MARKUP = new RegExp(
  GRAMMAR_TOKENS.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
);

describe('parseModelOutput — answer is clean by construction (the anti-leak contract)', () => {
  const toolBlock = '<tool_call>\n<function=search_kb>\n<parameter=query>\nAchilles\n</parameter>\n</function>\n</tool_call>';
  const cases: Array<[string, string, string | null]> = [
    ['inline <think>', `<think>reasoning</think>\nThe answer.`, null],
    ['inline <think> + tool block', `<think>r</think>\n${toolBlock}`, null],
    ['separate channel + tool block in content', toolBlock, 'the reasoning'],
    ['Gemma channel', `<|channel>thought\nreasoning\n<channel|>The answer.`, null],
    // DEVICE 2026-07-14: empty thought → Gemma drops the newline and goes STRAIGHT to a tool call
    // (`<|channel>thought<|tool_call>…`), separate reasoning channel already extracted. The bare opener
    // (no `\n`) used to survive stripping and render as visible pre-text above the tool card. The
    // optional-newline grammar now strips it. reasoning present → the reasoning-channel branch.
    ['Gemma bare opener before tool call (empty thought)', `<|channel>thought<|tool_call>call:calculator{expression:300 * 591}`, 'the reasoning'],
    ['Qwen channel', `<|channel|>analysis<|message|>reasoning<|channel|>final<|message|>The answer.`, null],
    ['gemma tool token', `Sure. <|tool_call>{"name":"x"}<tool_call|>`, null],
    ['answer only', `Just a plain answer.`, null],
    ['reasoning only (no answer)', `<think>only reasoning, no answer</think>`, null],
  ];
  it.each(cases)('%s: answer carries no markup', (_label, content, reasoning) => {
    const { answer } = parseModelOutput(content, reasoning);
    expect(answer).not.toMatch(MARKUP);
  });

  it('reasoning-only message does NOT duplicate reasoning into answer', () => {
    const { reasoning, answer } = parseModelOutput('<think>abc</think>', null);
    expect(reasoning).toContain('abc');
    expect(answer).toBe('');
  });
});
