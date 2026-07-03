export interface ToolDefinition {
  id: string;
  name: string;
  displayName: string;
  description: string;
  icon: string;
  parameters: Record<string, ToolParameter>;
  requiresNetwork?: boolean;
}

export interface ToolParameter {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, any>;
  context?: { projectId?: string };
}

/** How a tool call resolved. The loop sets this for EVERY call so the model and UI
 *  get an unambiguous signal — a failure or empty result is never mistaken for a
 *  successful one. */
export type ToolResultStatus = 'ok' | 'empty' | 'error';

/** Coarse failure cause, so the model/UI can tell "retry might help" (timeout/network)
 *  from "the call was wrong" (validation/not-found) from an internal bug. */
export type ToolErrorCategory = 'timeout' | 'network' | 'validation' | 'not-found' | 'internal';

export interface ToolResult {
  toolCallId?: string;
  name: string;
  content: string;
  error?: string;
  /** Set when status==='error'. */
  errorCategory?: ToolErrorCategory;
  /** Derived/normalized by the loop (normalizeToolResult): ok | empty | error. */
  status?: ToolResultStatus;
  durationMs: number;
}
