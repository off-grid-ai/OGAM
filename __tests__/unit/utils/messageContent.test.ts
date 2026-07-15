/**
 * messageContent Utility Unit Tests
 *
 * Tests for stripControlTokens - the utility that removes LLM control tokens
 * from streamed content before displaying to users.
 * Priority: P0 (Critical) - Prevents raw control tokens from appearing in chat.
 */

import { stripControlTokens, templateEmitsReasoning } from '../../../src/utils/messageContent';

describe('templateEmitsReasoning', () => {
  it('returns false for null/undefined/empty template', () => {
    expect(templateEmitsReasoning(null)).toBe(false);
    expect(templateEmitsReasoning(undefined)).toBe(false);
    expect(templateEmitsReasoning('')).toBe(false);
  });

  it('detects a <think> reasoning template (DeepSeek/Qwen, the OD7 Qwythos case)', () => {
    expect(templateEmitsReasoning('{{ bos }}<think>\n{{ reasoning }}\n</think>{{ content }}')).toBe(true);
  });

  it('detects a Gemma <|channel>thought template', () => {
    expect(templateEmitsReasoning('x <|channel>thought\n y')).toBe(true);
  });

  it('detects a Qwen <|channel|>analysis template', () => {
    expect(templateEmitsReasoning('a <|channel|>analysis<|message|> b')).toBe(true);
  });

  it('detects an enable_thinking-kwarg template (capability, no literal <think> in the template)', () => {
    // The reliable reasoning-capability signal remoteModelCapabilities keys on: a
    // template that exposes the enable_thinking switch supports reasoning on demand
    // even if it does not embed a literal <think>. Local detection MUST agree with
    // remote, or a model reads reasoning-capable on the gateway but not on-device (OD7 §C).
    expect(templateEmitsReasoning('{%- if enable_thinking %}...{%- endif %}')).toBe(true);
  });

  it('returns false for a plain (non-reasoning) chat template', () => {
    expect(templateEmitsReasoning('{{ bos }}{{ system }}{{ user }}{{ assistant }}')).toBe(false);
  });
});

describe('stripControlTokens', () => {
  // ==========================================================================
  // Basic control token removal
  // ==========================================================================
  describe('individual token patterns', () => {
    it('strips <|im_start|>', () => {
      expect(stripControlTokens('Hello<|im_start|>World')).toBe('HelloWorld');
    });

    it('strips <|im_start|> with role (assistant)', () => {
      expect(stripControlTokens('<|im_start|>assistant\nHello')).toBe('Hello');
    });

    it('strips <|im_start|> with role (user)', () => {
      expect(stripControlTokens('<|im_start|>user\nHello')).toBe('Hello');
    });

    it('strips <|im_start|> with role (system)', () => {
      expect(stripControlTokens('<|im_start|>system\nYou are helpful')).toBe('You are helpful');
    });

    it('strips <|im_start|> with role (tool)', () => {
      expect(stripControlTokens('<|im_start|>tool\nresult')).toBe('result');
    });

    it('strips <|im_end|>', () => {
      expect(stripControlTokens('Hello world<|im_end|>')).toBe('Hello world');
    });

    it('strips <|im_end|> with trailing newline', () => {
      expect(stripControlTokens('Hello<|im_end|>\n')).toBe('Hello');
    });

    it('strips <|end|>', () => {
      expect(stripControlTokens('Response text<|end|>')).toBe('Response text');
    });

    it('strips <|eot_id|>', () => {
      expect(stripControlTokens('Llama response<|eot_id|>')).toBe('Llama response');
    });

    it('strips </s>', () => {
      expect(stripControlTokens('Generated text</s>')).toBe('Generated text');
    });
  });

  // ==========================================================================
  // Multiple tokens
  // ==========================================================================
  describe('multiple tokens', () => {
    it('strips multiple different control tokens', () => {
      const input = '<|im_start|>assistant\nHello world<|im_end|></s>';
      expect(stripControlTokens(input)).toBe('Hello world');
    });

    it('strips repeated same tokens', () => {
      const input = 'A<|im_end|>B<|im_end|>C';
      expect(stripControlTokens(input)).toBe('ABC');
    });

    it('strips all token types in one string', () => {
      const input = '<|im_start|>user\nQ<|im_end|><|end|><|eot_id|></s>';
      expect(stripControlTokens(input)).toBe('Q');
    });

    it('strips tokens scattered throughout content', () => {
      // Note: <|im_end|>\s* pattern consumes optional trailing whitespace
      const input = 'Hello<|im_end|> there<|eot_id|> friend</s>';
      expect(stripControlTokens(input)).toBe('Hellothere friend');
    });
  });

  // ==========================================================================
  // Case insensitivity
  // ==========================================================================
  describe('case insensitivity', () => {
    it('strips <|IM_START|> (uppercase)', () => {
      expect(stripControlTokens('<|IM_START|>Hello')).toBe('Hello');
    });

    it('strips <|Im_End|> (mixed case)', () => {
      expect(stripControlTokens('Hello<|Im_End|>')).toBe('Hello');
    });

    it('strips </S> (uppercase)', () => {
      expect(stripControlTokens('Text</S>')).toBe('Text');
    });

    it('strips <|EOT_ID|> (uppercase)', () => {
      expect(stripControlTokens('Text<|EOT_ID|>')).toBe('Text');
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================
  describe('edge cases', () => {
    it('returns empty string for empty input', () => {
      expect(stripControlTokens('')).toBe('');
    });

    it('returns content unchanged when no control tokens present', () => {
      const content = 'This is a normal response with no special tokens.';
      expect(stripControlTokens(content)).toBe(content);
    });

    it('returns empty string when input is only control tokens', () => {
      expect(stripControlTokens('<|im_start|>assistant\n<|im_end|>')).toBe('');
    });

    it('trims leading/trailing whitespace in content', () => {
      expect(stripControlTokens('  Hello  World  ')).toBe('Hello  World');
    });

    it('preserves HTML-like tags that are not control tokens', () => {
      expect(stripControlTokens('<b>bold</b> <i>italic</i>')).toBe('<b>bold</b> <i>italic</i>');
    });

    it('preserves markdown formatting', () => {
      const markdown = '# Title\n\n- Item 1\n- Item 2\n\n```code```';
      expect(stripControlTokens(markdown)).toBe(markdown);
    });

    it('handles content with unicode characters', () => {
      expect(stripControlTokens('Hello 🌍<|im_end|>')).toBe('Hello 🌍');
    });

    it('handles content with newlines and tabs', () => {
      expect(stripControlTokens('Line 1\nLine 2\tTabbed<|im_end|>')).toBe('Line 1\nLine 2\tTabbed');
    });

    it('strips <|im_start|> with extra whitespace before role', () => {
      expect(stripControlTokens('<|im_start|>  assistant\nHello')).toBe('Hello');
    });

    it('strips <|im_start|> without role', () => {
      expect(stripControlTokens('<|im_start|>Hello')).toBe('Hello');
    });

    it('handles content with angle brackets that look similar', () => {
      expect(stripControlTokens('Use <div> and </div> tags')).toBe('Use <div> and </div> tags');
    });

    it('handles very long content efficiently', () => {
      const longContent = `${'word '.repeat(10000)  }<|im_end|>`;
      const result = stripControlTokens(longContent);
      expect(result).not.toContain('<|im_end|>');
      expect(result.trim().split(' ')).toHaveLength(10000);
    });
  });

  // ==========================================================================
  // Tool call tag stripping
  // ==========================================================================
  describe('tool_call tag stripping', () => {
    it('strips tool_call tags with JSON content', () => {
      expect(stripControlTokens('Hello <tool_call>{"name":"calc"}</tool_call> world')).toBe('Hello world');
    });

    it('strips multiple tool_call tags', () => {
      const input = 'Start <tool_call>{"name":"add","args":{"a":1}}</tool_call> middle <tool_call>{"name":"sub","args":{"b":2}}</tool_call> end';
      expect(stripControlTokens(input)).toBe('Start middle end');
    });

    it('strips multiline tool_call content', () => {
      const input = 'Before <tool_call>\n{\n  "name": "search",\n  "query": "test"\n}\n</tool_call> after';
      expect(stripControlTokens(input)).toBe('Before after');
    });

    // DR7 follow-on: the tool-loop extractor (parseXmlStyleToolCall in generationToolLoop)
    // accepts `<function=NAME>…<parameter=NAME>…</function>` markup, but the shared stripper
    // did NOT strip it — so a model emitting this form leaked the raw markup into the visible
    // answer. Stripper and extractor must recognise the SAME grammar.
    it('strips <function=…>/<parameter=…> XML-style tool-call markup (extractor grammar)', () => {
      const input =
        'Sure, let me check.\n<function=get_weather>{"city":"Paris"}<parameter=unit>celsius</parameter></function>\nDone.';
      const stripped = stripControlTokens(input);
      expect(stripped).not.toContain('<function=');
      expect(stripped).not.toContain('<parameter=');
      expect(stripped).not.toContain('</function>');
      expect(stripped).toContain('Sure, let me check.');
      expect(stripped).toContain('Done.');
    });

    it('strips an unclosed <function=…> tool-call opener at end (EOS mid-call)', () => {
      expect(
        stripControlTokens('Working on it.<function=get_weather>{"city":"NY'),
      ).toBe('Working on it.');
    });
  });


  // ==========================================================================
  // Streaming simulation
  // ==========================================================================
  describe('streaming token accumulation', () => {
    it('handles incremental stripping (simulating streaming)', () => {
      let accumulated = '';

      accumulated = stripControlTokens(`${accumulated  }Hello`);
      expect(accumulated).toBe('Hello');

      accumulated = stripControlTokens(`${accumulated  } world`);
      expect(accumulated).toBe('Hello world');

      accumulated = stripControlTokens(`${accumulated  }<|im_end|>`);
      expect(accumulated).toBe('Hello world');
    });

    it('handles control token split across two chunks', () => {
      // In real streaming, a token like <|im_end|> arrives as a single token
      // but the accumulated string is re-stripped each time
      let accumulated = 'Response text';
      accumulated = stripControlTokens(`${accumulated  }<|im_end|>`);
      expect(accumulated).toBe('Response text');
    });
  });
});
