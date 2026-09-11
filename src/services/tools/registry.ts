import { ToolDefinition } from './types';
import {
  CORE_TOOL_CATALOG,
  catalogEntryToDefinition,
  definitionToOpenAITool,
} from '@offgrid/models';

export const AVAILABLE_TOOLS: ToolDefinition[] = CORE_TOOL_CATALOG.map(tool => ({
  ...tool,
  icon: tool.icon ?? 'tool',
}));

export function getToolsAsOpenAISchema(enabledToolIds: string[]) {
  return AVAILABLE_TOOLS
    .filter(tool => enabledToolIds.includes(tool.id))
    .map(tool => definitionToOpenAITool(catalogEntryToDefinition(tool)));
}

export function buildToolSystemPromptHint(enabledToolIds: string[]): string {
  const enabledTools = AVAILABLE_TOOLS.filter(t => enabledToolIds.includes(t.id));
  if (enabledTools.length === 0) return '';

  const toolList = enabledTools.map(t => `- ${t.name}: ${t.description}`).join('\n');
  return `\n\nTools available:\n${toolList}\nUse these tools proactively and precisely — call the right tool at the right moment rather than guessing or saying you cannot help.`;
}
