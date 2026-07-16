/**
 * The one place that turns ANY tool outcome — a returned result, an empty result,
 * or a thrown error — into a typed, model-readable ToolResult. Every tool path
 * (built-in, pro/email, MCP) funnels through here via the tool loop, so:
 *   - a tool that THROWS becomes a typed 'error' result (it never crashes the turn),
 *   - an empty result is marked 'empty' (not a silent success),
 *   - the string handed to the model is NEVER empty and explicitly states failure,
 *     so the model can't mistake a timeout / disconnected server / no-data for a
 *     successful answer (the root of the "tools give improper information" reports).
 *
 * Pure + UI-free so both core and pro depend on it without dragging UI in.
 */
import type { ToolCall, ToolResult, ToolErrorCategory } from './types';

/** Best-effort classification of a failure from its message (one place this lives). */
export function classifyToolError(err: unknown): ToolErrorCategory {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (/abort|timed out|timeout/.test(msg)) return 'timeout';
  if (/network|fetch|enotfound|econn|unreachable|not connected|no server owns|offline|socket/.test(msg)) return 'network';
  if (/invalid|required|missing|bad request|validation|schema|malformed/.test(msg)) return 'validation';
  if (/not found|no such|unknown tool|404|does not exist/.test(msg)) return 'not-found';
  return 'internal';
}

/** Build an error result for a thrown tool call. */
export function toolErrorResult(call: ToolCall, err: unknown, startMs: number): ToolResult {
  const error = err instanceof Error ? err.message : String(err);
  return {
    toolCallId: call.id,
    name: call.name,
    content: '',
    error,
    errorCategory: classifyToolError(err),
    status: 'error',
    durationMs: Math.max(0, Date.now() - startMs),
  };
}

/** Fill in toolCallId + status (and errorCategory for errors) on a returned result.
 *  Producers may omit these; the loop normalizes so downstream is uniform. */
export function normalizeToolResult(call: ToolCall, raw: ToolResult): ToolResult {
  const toolCallId = raw.toolCallId ?? call.id;
  if (raw.error) {
    return {
      ...raw,
      toolCallId,
      status: 'error',
      errorCategory: raw.errorCategory ?? classifyToolError(new Error(raw.error)),
    };
  }
  const hasContent = !!raw.content && raw.content.trim().length > 0;
  return { ...raw, toolCallId, status: hasContent ? 'ok' : 'empty' };
}

/**
 * Defensive cap on the tool result fed back to the model. A badly-behaved tool (e.g. an MCP that
 * returns an entire wiki — device 2026-07-14: read_wiki_contents returned 1.27M chars) would otherwise
 * overflow ANY model context and wedge the turn. ~24k chars ≈ 6k tokens: enough to be useful, bounded
 * enough to fit alongside the prompt on common contexts. We keep the HEAD (overviews lead) and tell the
 * model it was truncated so it doesn't assume it saw everything. This gate is upstream-agnostic — it
 * protects against any oversized result, no matter how the tool is written.
 */
export const MAX_TOOL_RESULT_CHARS = 24000;

/**
 * The content string the MODEL sees. Never empty; failures and empties are stated
 * explicitly so the model treats them as such instead of inventing an answer.
 */
export function toolResultModelContent(result: ToolResult): string {
  if (result.status === 'error') {
    const cat = result.errorCategory ?? 'internal';
    return `Tool "${result.name}" failed (${cat}): ${result.error ?? 'unknown error'}. It returned no data — do not assume it succeeded.`;
  }
  if (result.status === 'empty') {
    return `Tool "${result.name}" ran but returned no content.`;
  }
  if (result.content.length > MAX_TOOL_RESULT_CHARS) {
    const kept = result.content.slice(0, MAX_TOOL_RESULT_CHARS);
    return `${kept}\n\n[Tool "${result.name}" result truncated: showing the first ${MAX_TOOL_RESULT_CHARS} of ${result.content.length} characters. The result was too large to send in full — ask a more specific follow-up if you need more.]`;
  }
  return result.content;
}
