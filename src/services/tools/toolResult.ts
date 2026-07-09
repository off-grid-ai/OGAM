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
  return result.content;
}
