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
}

const extensions: ToolExtension[] = [];

export function registerToolExtension(ext: ToolExtension): void {
  if (!extensions.some(e => e.id === ext.id)) extensions.push(ext);
}

/** Remove a feature-owned extension so revoked tools cannot execute. */
export function unregisterToolExtension(id: string): void {
  const index = extensions.findIndex(extension => extension.id === id);
  if (index !== -1) extensions.splice(index, 1);
}

export function getToolExtensions(): ToolExtension[] {
  return extensions;
}

export function _clearExtensionsForTesting(): void {
  extensions.length = 0;
}
