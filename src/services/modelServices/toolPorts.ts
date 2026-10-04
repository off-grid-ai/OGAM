import {
  type GenerationToolDefinition,
  MOBILE_TEXT_SETTINGS_DEFAULTS,
  openAIToolToDefinition,
  toolSchemaTokenBudget,
} from '@offgrid/models';
import type { ToolRoutingService } from '@offgrid/models';
import { toolRouting } from '../composition/tools';
import logger from '../../utils/logger';
import { getToolsAsOpenAISchema } from '../tools';
import { getToolExtensions } from '../tools/extensions';
import { mobileTextEngineControl } from './textEngineControl';
import { isMcpEnabled } from '../mcpContextBoost';
import { applicationFacade } from '../applicationFacade';

const toolRoutingService = (): ToolRoutingService => toolRouting();

/** Build one shared schema projection from Mobile's raw tool registries. */
export async function mobileToolDefinitions(
  enabledToolIds: string[],
  messages: import('../../types').Message[],
): Promise<GenerationToolDefinition[]> {
  const builtInTools = getToolsAsOpenAISchema(enabledToolIds)
    .flatMap(schema => {
      const definition = openAIToolToDefinition(schema);
      return definition ? [definition] : [];
    });
  const externalTools = getToolExtensions()
    .flatMap(extension => extension.getOpenAISchemas?.() ?? [])
    .flatMap(schema => {
      const definition = openAIToolToDefinition(schema);
      return definition ? [definition] : [];
    });
  const contextLengthValue =
    applicationFacade().models.settings.current().contextLength;
  const contextLength =
    typeof contextLengthValue === 'number' &&
    Number.isFinite(contextLengthValue) &&
    contextLengthValue > 0
      ? contextLengthValue
      : MOBILE_TEXT_SETTINGS_DEFAULTS.contextLength;
  const result = await toolRoutingService().select({
    messages: messages.map(message => ({
      role: message.role,
      content: message.content,
    })),
    builtInTools,
    externalTools,
    remoteModel: mobileTextEngineControl.isRemoteActive(),
    embeddingRouting: isMcpEnabled(),
    modelRouting: true,
    schemaTokenLimit: toolSchemaTokenBudget(contextLength),
  });
  if (result.fallbackReason) {
    logger.warn(`[SharedTools] ${result.strategy} selection failed (${result.fallbackReason}); using all tools`);
  }
  return result.tools;
}
