import type {
  SharedToolCall,
  SharedToolResult,
  ToolCatalogEntry,
} from '@offgrid/models';

/** Mobile presentation metadata is the shared catalog contract. */
export type ToolDefinition = ToolCatalogEntry & { icon: string };

export interface ToolCall extends Omit<SharedToolCall, 'arguments'> {
  arguments: Record<string, any>;
  context?: {
    conversationId?: string;
    projectId?: string;
  };
}

export type ToolResult = SharedToolResult;
