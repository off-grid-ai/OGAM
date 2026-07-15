/**
 * The tool-result contract: a thrown error becomes a typed 'error' result, an empty
 * result is marked 'empty' (not a silent success), and the model-facing string is
 * never empty and states failure explicitly — so the model can't mistake a
 * timeout / disconnected server / no-data for a successful answer.
 */
import {
  classifyToolError,
  toolErrorResult,
  normalizeToolResult,
  toolResultModelContent,
  MAX_TOOL_RESULT_CHARS,
} from '../../../../src/services/tools/toolResult';
import type { ToolCall } from '../../../../src/services/tools/types';

const call: ToolCall = { id: 'c1', name: 'web_search', arguments: { query: 'x' } };

describe('classifyToolError', () => {
  it('maps messages to coarse categories', () => {
    expect(classifyToolError(new Error('The operation was aborted'))).toBe('timeout');
    expect(classifyToolError(new Error('request timed out'))).toBe('timeout');
    expect(classifyToolError(new Error('network error'))).toBe('network');
    expect(classifyToolError(new Error('Server "x" is not connected'))).toBe('network');
    expect(classifyToolError(new Error('Missing required parameter: to'))).toBe('validation');
    expect(classifyToolError(new Error('No server owns tool "y"'))).toBe('network');
    expect(classifyToolError(new Error('unknown tool foo'))).toBe('not-found');
    expect(classifyToolError(new Error('boom'))).toBe('internal');
  });
});

describe('toolErrorResult', () => {
  it('builds a typed error result with the call id and category', () => {
    const r = toolErrorResult(call, new Error('request timed out'), Date.now() - 5);
    expect(r.status).toBe('error');
    expect(r.errorCategory).toBe('timeout');
    expect(r.toolCallId).toBe('c1');
    expect(r.content).toBe('');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('normalizeToolResult', () => {
  it('marks a non-empty result ok and fills toolCallId', () => {
    const r = normalizeToolResult(call, { name: 'web_search', content: 'results', durationMs: 10 });
    expect(r.status).toBe('ok');
    expect(r.toolCallId).toBe('c1');
  });

  it('marks an empty result as empty (not ok)', () => {
    const r = normalizeToolResult(call, { name: 'web_search', content: '   ', durationMs: 10 });
    expect(r.status).toBe('empty');
  });

  it('marks a result carrying an error as error and derives a category', () => {
    const r = normalizeToolResult(call, { name: 'web_search', content: '', error: 'network error', durationMs: 10 });
    expect(r.status).toBe('error');
    expect(r.errorCategory).toBe('network');
  });
});

describe('toolResultModelContent', () => {
  it('returns the content for an ok result', () => {
    expect(toolResultModelContent({ name: 'web_search', content: 'hi', status: 'ok', durationMs: 1 })).toBe('hi');
  });

  it('states failure explicitly (never empty) for an error', () => {
    const text = toolResultModelContent({ name: 'github', content: '', error: 'down', errorCategory: 'network', status: 'error', durationMs: 1 });
    expect(text).toContain('failed');
    expect(text).toContain('network');
    expect(text).toContain('do not assume it succeeded');
  });

  it('states empty explicitly so empty is never mistaken for success', () => {
    const text = toolResultModelContent({ name: 'web_search', content: '', status: 'empty', durationMs: 1 });
    expect(text).toContain('no content');
    expect(text.length).toBeGreaterThan(0);
  });

  it('caps an oversized result so a bad tool cannot overflow the model context (device 2026-07-14: read_wiki_contents returned 1.27M chars)', () => {
    const huge = 'A'.repeat(MAX_TOOL_RESULT_CHARS + 5000);
    const text = toolResultModelContent({ name: 'read_wiki_contents', content: huge, status: 'ok', durationMs: 1 });
    // Bounded well under the raw payload (kept head + a short note), so it can never blow the context.
    expect(text.length).toBeLessThan(huge.length);
    expect(text.length).toBeLessThan(MAX_TOOL_RESULT_CHARS + 500);
    // Keeps the HEAD (overviews lead) and tells the model it was truncated so it won't assume it saw all.
    expect(text.startsWith('A'.repeat(100))).toBe(true);
    expect(text).toContain('truncated');
    expect(text).toContain(String(huge.length));
  });

  it('leaves a result at or under the cap untouched', () => {
    const ok = 'B'.repeat(MAX_TOOL_RESULT_CHARS);
    expect(toolResultModelContent({ name: 't', content: ok, status: 'ok', durationMs: 1 })).toBe(ok);
  });
});
