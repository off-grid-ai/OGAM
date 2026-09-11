import type { ToolCall, ToolResult, ToolDefinition } from './types';

export interface ToolExtension {
  id: string;
  getSystemPromptHint(): string;
  getOpenAISchemas?(): any[];
  // Tools that should surface in the main ToolPickerSheet (toggled via the core
  // enabledTools setting), as opposed to MCP which has its own picker.
  getToolDefinitions?(): ToolDefinition[];
  parseToolCalls(text: string): ToolCall[];
  stripFromVisibleText(text: string): string;
  canHandle(toolName: string): boolean;
  execute(call: ToolCall): Promise<ToolResult>;
  enabledToolCount(): number;
  /**
   * Notify when the answer to `enabledToolCount` may have changed.
   *
   * The count is read imperatively at render time, so a surface showing it never re-renders on its
   * own when the extension's backing store moves - deactivating an MCP server left the chat's
   * "Pro Tools" badge at the old count until the screen was remounted. Optional: an extension whose
   * count is constant (email/calendar returns 0) has nothing to report.
   */
  subscribe?(listener: () => void): () => void;
}

const extensions: ToolExtension[] = [];
const listeners = new Set<() => void>();

export function registerToolExtension(ext: ToolExtension): () => void {
  if (extensions.some(e => e.id === ext.id)) return () => undefined;
  extensions.push(ext);
  // The registry is an external store to anyone rendering from it, and an extension can register
  // AFTER a consumer mounted (Pro activates at runtime). The effective-tool projection rewires its
  // source subscriptions when this registry changes. Mirrors screenRegistry for the same reason.
  listeners.forEach(l => l());
  return () => {
    const index = extensions.indexOf(ext);
    if (index < 0) return;
    extensions.splice(index, 1);
    listeners.forEach(l => l());
  };
}

/** Registry-change subscription: fires when an extension registers (or tests clear the set). */
export function subscribeToolExtensions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToolExtensions(): ToolExtension[] {
  return extensions;
}

export function _clearExtensionsForTesting(): void {
  extensions.length = 0;
  listeners.forEach(l => l());
}
