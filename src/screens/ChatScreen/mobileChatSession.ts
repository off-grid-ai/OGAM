import {
  CHAT_GENERATION_RECLAIM_POLICY,
  ModelsFailureError,
  WorkspaceContentChatSessionAdapterError,
  generationMessageText,
  type ChatQueueProjection,
  type ChatTurn,
  type GenerationOperation,
  type Outcome,
  type ModelsFailure,
} from '@offgrid/application';
import { applicationFacade } from '../../services/applicationFacade';
import {
  mobileChatRequestDefaults,
  mobileGenerationMessage,
  mobileWorkspaceGenerationMessage,
  withMobileChatCommandOptions,
  type MobileChatCommandOptions,
} from '../../services/adapters/models/mobileChatHostPort';
import { registerMobileChatSessionControl } from '../../services/modelServices/chatSessionControl';
import type { Message } from '../../types';

export type { MobileChatCommandOptions } from '../../services/adapters/models/mobileChatHostPort';
export { projectClassifierFailure } from '../../services/adapters/models/mobileChatHostPort';

registerMobileChatSessionControl({
  stopActive: () => applicationFacade().models.chat.stop(),
  stopConversation: conversationId =>
    applicationFacade().models.chat.stopConversation(conversationId),
});

/** Application lifecycle step. Shared owns the reclaim rule; Mobile supplies the runtime port. */
export async function prepareMobileChatGeneration(): Promise<void> {
  const outcome = await applicationFacade().models.reclaim(
    CHAT_GENERATION_RECLAIM_POLICY,
  );
  if (!outcome.ok) throw outcome.failure;
}

function requireChatTurn(outcome: Outcome<ChatTurn, ModelsFailure>): ChatTurn {
  if (!outcome.ok) throw new ModelsFailureError(outcome.failure);
  return outcome.value;
}

export const mobileChatSession = {
  /** Execute a user row that Mobile has already persisted. */
  async sendPersisted(
    conversationId: string,
    turnId: string,
    options: MobileChatCommandOptions = {},
  ): Promise<ChatTurn> {
    const workspaceContent = applicationFacade().workspaceContent.snapshot();
    if (workspaceContent.status !== 'ready') {
      throw new WorkspaceContentChatSessionAdapterError('read', {
        kind: 'not_ready',
        message: 'Workspace content is not ready.',
      });
    }
    const conversation = workspaceContent.conversations.find(
      candidate => candidate.id === conversationId,
    );
    if (!conversation) {
      throw new WorkspaceContentChatSessionAdapterError('read', {
        kind: 'not_found',
        entity: 'conversation',
        id: conversationId,
        message: `Conversation ${conversationId} was not found.`,
      });
    }
    const message = workspaceContent.messages.find(
      candidate =>
        candidate.id === turnId && candidate.conversationId === conversationId,
    );
    if (!message) {
      throw new WorkspaceContentChatSessionAdapterError('read', {
        kind: 'not_found',
        entity: 'message',
        id: turnId,
        message: `Message ${turnId} was not found in conversation ${conversationId}.`,
      });
    }
    if (message.portable.role !== 'user') {
      throw new WorkspaceContentChatSessionAdapterError('read', {
        kind: 'conflict',
        message: `Message ${turnId} does not have the user role.`,
      });
    }
    const userMessage = mobileWorkspaceGenerationMessage(message);
    const recordedOperation: GenerationOperation | undefined =
      options.imageMode === 'force'
        ? { type: 'image', prompt: generationMessageText(userMessage) }
        : options.imageMode === 'disabled'
        ? { type: 'text' }
        : undefined;
    return withMobileChatCommandOptions(turnId, options, async () =>
      requireChatTurn(
        await applicationFacade().models.chat.send({
          conversationId,
          turnId,
          userMessageId: message.id,
          projectId: conversation.projectId ?? undefined,
          userMessage,
          operation: recordedOperation,
          request: mobileChatRequestDefaults(),
        }),
      ),
    );
  },

  async regenerate(
    conversationId: string,
    turnId: string,
    input?:
      | GenerationOperation
      | {
          operation?: GenerationOperation;
          options?: MobileChatCommandOptions;
        },
  ): Promise<ChatTurn> {
    const operation = input && 'type' in input ? input : input?.operation;
    const options = input && 'type' in input ? {} : input?.options ?? {};
    applicationFacade().models.chat.invalidate(conversationId);
    return withMobileChatCommandOptions(turnId, options, async () =>
      requireChatTurn(
        await applicationFacade().models.chat.regenerate({
          conversationId,
          turnId,
          operation,
          request: mobileChatRequestDefaults(),
        }),
      ),
    );
  },

  async edit(
    conversationId: string,
    turnId: string,
    message: Message,
  ): Promise<ChatTurn> {
    applicationFacade().models.chat.invalidate(conversationId);
    return requireChatTurn(
      await applicationFacade().models.chat.edit({
        conversationId,
        turnId,
        userMessage: mobileGenerationMessage(message),
        request: mobileChatRequestDefaults(),
      }),
    );
  },

  stop: (): boolean => applicationFacade().models.chat.stop(),

  stopConversation: (conversationId: string): number =>
    applicationFacade().models.chat.stopConversation(conversationId),

  clearQueued: (): void => applicationFacade().models.chat.clearQueued(),

  subscribeQueue(
    listener: (projection: ChatQueueProjection) => void,
  ): () => void {
    const chat = applicationFacade().models.chat;
    listener(chat.snapshot());
    return chat.subscribe(listener);
  },

  invalidate: (conversationId: string): void =>
    applicationFacade().models.chat.invalidate(conversationId),

  /**
   * Ask the chat rules to repair a conversation the previous run left mid-flight.
   *
   * Called when a person opens a chat. The screen never decides for itself whether a saved reply
   * was cut short: only the chat rules own that, and they record the repaired state before this
   * resolves.
   */
  restore: async (conversationId: string): Promise<void> => {
    await applicationFacade().models.chat.restore(conversationId);
  },
};
