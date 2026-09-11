import {
  type GenerationToolDefinition,
  MOBILE_TEXT_SETTINGS_DEFAULTS,
  toolSchemaTokenBudget,
} from '@offgrid/models';
import type { ToolRoutingService } from '@offgrid/models';
import { toolRouting } from '../composition/tools';
import logger from '../../utils/logger';
import { mobileTextEngineControl } from './textEngineControl';
import { isMcpEnabled } from '../mcpContextBoost';
import { applicationFacade } from '../applicationFacade';
import { effectiveChatTools } from '../composition/effectiveToolProjection';

const toolRoutingService = (): ToolRoutingService => toolRouting();

/** Build one shared schema projection from Mobile's raw tool registries. */
export async function mobileToolDefinitions(
  messages: import('../../types').Message[],
  memoryScope: { projectActive: boolean; allMemory: boolean },
): Promise<GenerationToolDefinition[]> {
  const effective = effectiveChatTools().forTurn({
    memoryScope,
    imageAvailable: true,
    proposalDeckAvailable: true,
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
    builtInTools: effective.builtInTools,
    externalTools: effective.externalTools,
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
