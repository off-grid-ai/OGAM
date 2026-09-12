/**
 * ChatMessage/utils Tests
 *
 * Unit tests for parseThinkingContent, formatTime, formatDuration
 */

import { buildMessageData, parseThinkingContent, formatTime, formatDuration } from '../../../../src/components/ChatMessage/utils';

describe('buildMessageData', () => {
  it('reuses a committed message projection until its content changes', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: '<think>Check</think>Answer',
      timestamp: 1,
    };
    const first = buildMessageData(message);
    expect(buildMessageData(message)).toBe(first);

    message.content = '<think>Check again</think>New answer';
    const changed = buildMessageData(message);
    expect(changed).not.toBe(first);
    expect(changed.displayContent).toBe('New answer');
  });
});

describe('parseThinkingContent', () => {
  // ============================================================================
  // No thinking markers
  // ============================================================================
  describe('no thinking markers', () => {
    it('returns plain content as response when no markers', () => {
      const result = parseThinkingContent('Hello world');
      expect(result).toEqual({ thinking: null, response: 'Hello world', isThinkingComplete: true });
    });

    it('returns empty string as response for empty content', () => {
      const result = parseThinkingContent('');
      expect(result).toEqual({ thinking: null, response: '', isThinkingComplete: true });
    });
  });

  // ============================================================================
  // <think> / </think> format
  // ============================================================================
  describe('<think></think> format', () => {
    it('extracts thinking and response from complete think block', () => {
      const result = parseThinkingContent('<think>I need to reason</think>The answer is 42');
      expect(result.thinking).toBe('I need to reason');
      expect(result.response).toBe('The answer is 42');
      expect(result.isThinkingComplete).toBe(true);
    });

    it('returns incomplete thinking when only <think> tag present', () => {
      const result = parseThinkingContent('<think>Still thinking...');
      expect(result.thinking).toBe('Still thinking...');
      expect(result.response).toBe('');
      expect(result.isThinkingComplete).toBe(false);
    });

    it('handles case-insensitive <THINK> tag', () => {
      const result = parseThinkingContent('<THINK>reasoning</THINK>reply');
      expect(result.thinking).toBe('reasoning');
      expect(result.response).toBe('reply');
      expect(result.isThinkingComplete).toBe(true);
    });

    it('extracts thinkingLabel from __LABEL:...__ prefix', () => {
      const result = parseThinkingContent('<think>__LABEL:Step 1__\nreasoning here</think>response');
      expect(result.thinkingLabel).toBe('Step 1');
      expect(result.thinking).toBe('reasoning here');
      expect(result.response).toBe('response');
    });

    it('handles empty thinking block', () => {
      const result = parseThinkingContent('<think></think>response');
      expect(result.thinking).toBe('');
      expect(result.response).toBe('response');
      expect(result.isThinkingComplete).toBe(true);
    });

    it('trims whitespace from thinking and response', () => {
      const result = parseThinkingContent('<think>  reasoning  </think>  answer  ');
      expect(result.thinking).toBe('reasoning');
      expect(result.response).toBe('answer');
    });
  });

  // ============================================================================
  // </think> without <think> (orphan closing tag)
  // ============================================================================
  describe('orphan </think> without opening tag', () => {
    it('treats content before </think> as thinking when non-empty', () => {
      const result = parseThinkingContent('orphan thinking</think>response');
      expect(result.thinking).toBe('orphan thinking');
      expect(result.response).toBe('response');
      expect(result.isThinkingComplete).toBe(true);
    });

    it('falls through to plain content when nothing before </think>', () => {
      // Empty string before closing tag → thinkingContent is empty → plain response
      const result = parseThinkingContent('</think>just response');
      expect(result.thinking).toBeNull();
      expect(result.response).toBe('</think>just response');
    });
  });

  // ============================================================================
  // Channel-based format (<|channel|>analysis / final)
  // ============================================================================
  describe('channel format', () => {
    it('extracts thinking and response from complete channel block', () => {
      const content = '<|channel|>analysis<|message|>Let me think<|channel|>final<|message|>The answer';
      const result = parseThinkingContent(content);
      expect(result.thinking).toBe('Let me think');
      expect(result.response).toBe('The answer');
      expect(result.isThinkingComplete).toBe(true);
    });

    it('returns in-progress thinking when only analysis marker present', () => {
      const content = '<|channel|>analysis<|message|>Still reasoning...';
      const result = parseThinkingContent(content);
      expect(result.thinking).toBe('Still reasoning...');
      expect(result.response).toBe('');
      expect(result.isThinkingComplete).toBe(false);
    });

    it('handles out-of-order markers (final before analysis)', () => {
      // final marker appears before analysis marker in string
      const content = '<|channel|>final<|message|>oops<|channel|>analysis<|message|>late thinking';
      const result = parseThinkingContent(content);
      // Guard kicks in: finalStart < analysisStart
      expect(result.isThinkingComplete).toBe(false);
      expect(result.response).toBe('');
    });

    it('is case-insensitive for channel markers', () => {
      const content = '<|CHANNEL|>ANALYSIS<|MESSAGE|>thinking<|CHANNEL|>FINAL<|MESSAGE|>answer';
      const result = parseThinkingContent(content);
      expect(result.thinking).toBe('thinking');
      expect(result.response).toBe('answer');
      expect(result.isThinkingComplete).toBe(true);
    });

    it('channel format takes priority over think tags', () => {
      const content = '<|channel|>analysis<|message|><think>nested</think><|channel|>final<|message|>response';
      const result = parseThinkingContent(content);
      // Channel format is checked first
      expect(result.isThinkingComplete).toBe(true);
      expect(result.response).toBe('response');
    });
  });
});

describe('formatTime', () => {
  it('formats a timestamp as HH:MM', () => {
    const ts = new Date(2024, 0, 1, 14, 5, 30).getTime(); // 14:05:30
    const result = formatTime(ts);
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('formatDuration', () => {
  it('returns milliseconds for durations under 1 second', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('returns seconds with one decimal for durations under 1 minute', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(2500)).toBe('2.5s');
    expect(formatDuration(59999)).toBe('60.0s');
  });

  it('returns minutes and seconds for durations 1 minute or more', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(125000)).toBe('2m 5s');
  });
});
