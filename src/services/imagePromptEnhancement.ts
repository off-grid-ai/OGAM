import type { WorkspaceContentFailure } from '@offgrid/application';
import type { ImagePromptEnhancementService } from '@offgrid/models';
import { imagePromptEnhancement } from './composition/chat-services';
import { PROMPT_ENHANCEMENT_STATUS } from '@offgrid/sync';
import logger from '../utils/logger';
import { applicationFacade } from './applicationFacade';
import { generateId } from '../utils/generateId';
import { mobileResidencyIntents } from './modelServices/residencyIntents';
import { selectedTextModelId } from './modelServices/modelState';
import { mobileTextEngineControl } from './modelServices/textEngineControl';
import { executeMobileText } from './mobileSidecarGeneration';
import {
  buildEnhancementCardContent,
  getConversationContext,
  reportEnhancementSkipped,
} from './imageGenerationHelpers';
import type { GenerateImageParams } from './imageGenerationTypes';

/** Append the temporary enhancement-status card. Its id is minted by the caller so a later
 *  update or discard can address the same durable row. */
class EnhancementCardCommandError extends Error {
  constructor(readonly failure: WorkspaceContentFailure) {
    super(failure.message);
    this.name = 'EnhancementCardCommandError';
  }
}

async function appendEnhancementCard(
  conversationId: string,
  messageId: string,
  content: string,
): Promise<void> {
  const outcome = await applicationFacade().workspaceContent.execute({
    type: 'append_message',
    conversationId,
    messageId,
    portable: { role: 'assistant', content },
    local: { isThinking: true },
  });
  if (!outcome.ok) throw new EnhancementCardCommandError(outcome.failure);
}

async function updateEnhancementCard(
  messageId: string,
  content: string,
): Promise<void> {
  const workspaceContent = applicationFacade().workspaceContent;
  const portable = await workspaceContent.execute({
    type: 'update_message',
    messageId,
    portable: { role: 'assistant', content },
  });
  if (!portable.ok) throw new EnhancementCardCommandError(portable.failure);
}

async function completeEnhancementCard(messageId: string, content: string): Promise<void> {
  await updateEnhancementCard(messageId, content);
  const local = await applicationFacade().workspaceContent.execute({
    type: 'patch_message_local',
    messageId,
    patch: { isThinking: false },
  });
  if (!local.ok) throw new EnhancementCardCommandError(local.failure);
}

async function discardEnhancementCard(messageId: string): Promise<void> {
  const outcome = await applicationFacade().workspaceContent.execute({
    type: 'delete_message',
    messageId,
  });
  if (!outcome.ok) throw new EnhancementCardCommandError(outcome.failure);
}

type EnhancementStateWriter = (status: string) => void;

interface EnhancementCardCommandChain {
  readonly ports: ConstructorParameters<typeof ImagePromptEnhancementService>[0];
  readonly settle: () => Promise<void>;
}

/** Runtime, generation, and chat-card presentation ports for one enhancement. */
function mobileImagePromptEnhancementPorts(
  params: GenerateImageParams,
  setState: EnhancementStateWriter,
): EnhancementCardCommandChain {
  const conversationId = params.conversationId;
  let temporaryMessageId: string | null = null;
  let terminalQueued = false;
  let commandFailure: unknown;
  let commandChain = Promise.resolve();
  const enqueue = (label: string, command: () => Promise<void>): void => {
    commandChain = commandChain.then(async () => {
      try {
        await command();
      } catch (error) {
        commandFailure ??= error;
        logger.warn(`[ImageGen] Failed to ${label}:`, error);
      }
    });
  };
  const queueTerminal = (command: () => Promise<void>): void => {
    if (terminalQueued) return;
    terminalQueued = true;
    enqueue('settle enhancement card', command);
  };
  const ports: ConstructorParameters<typeof ImagePromptEnhancementService>[0] = {
    inspectText() {
      return {
        selected: !!selectedTextModelId(),
        remote: mobileTextEngineControl.isRemoteActive(),
        resident: mobileTextEngineControl.isReady(),
      };
    },
    async loadSelectedText() {
      const modelId = selectedTextModelId();
      if (!modelId) throw new Error('No text model is selected');
      await mobileResidencyIntents.ensureText(modelId);
    },
    generate(messages, onText) {
      return executeMobileText(
        messages.map(message => ({ role: message.role, content: message.content })),
        { onText },
      );
    },
    async stopGeneration() {
      await mobileTextEngineControl.stopActive();
    },
    onStatus(status) {
      setState(status === 'loading-model'
        ? 'Loading text model to enhance prompt...'
        : PROMPT_ENHANCEMENT_STATUS);
    },
    onStarted() {
      if (!conversationId) return;
      temporaryMessageId = generateId();
      const messageId = temporaryMessageId;
      enqueue('append enhancement card', () =>
        appendEnhancementCard(conversationId, messageId, PROMPT_ENHANCEMENT_STATUS));
    },
    onPartial(text) {
      if (!temporaryMessageId || terminalQueued) return;
      const messageId = temporaryMessageId;
      enqueue('update enhancement card', () =>
        updateEnhancementCard(messageId, buildEnhancementCardContent(text)));
    },
    onCompleted(prompt) {
      if (!temporaryMessageId) return;
      const messageId = temporaryMessageId;
      queueTerminal(() =>
        completeEnhancementCard(messageId, buildEnhancementCardContent(prompt)));
    },
    onDiscarded() {
      if (!temporaryMessageId) return;
      const messageId = temporaryMessageId;
      queueTerminal(() => discardEnhancementCard(messageId));
    },
    onSkipped: reportEnhancementSkipped,
    onFailure(error) {
      logger.warn('[ImageGen] Prompt enhancement boundary failed:', error);
    },
  };
  return {
    ports,
    async settle() {
      await commandChain;
      if (commandFailure) throw commandFailure;
    },
  };
}

/** Mobile is a native/runtime and presentation adapter for the Shared enhancement use case. */
export async function enhanceImagePrompt(
  params: GenerateImageParams,
  setState: EnhancementStateWriter,
): Promise<string> {
  const conversationId = params.conversationId;
  const card = mobileImagePromptEnhancementPorts(params, setState);
  const service = imagePromptEnhancement(card.ports);
  const result = await service.enhance({
    prompt: params.prompt,
    enabled:
      applicationFacade().models.settings.current().enhanceImagePrompts ===
      true,
    context: conversationId
      ? getConversationContext(conversationId).map(message => ({
          role: message.role as 'user' | 'assistant',
          content: message.content,
        }))
      : [],
  });
  await card.settle();
  return result;
}
