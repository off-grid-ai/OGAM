import { Dispatch, SetStateAction } from 'react';
import { showAlert, AlertState } from '../../components';
import { Message } from '../../types';
import { replacePortableMessageText } from '@offgrid/application';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import {
  editPersistedChatTurnFn,
  executeDeleteConversationFn,
  generateImageForPersistedTurnFn,
  replayPersistedChatTurnFn,
} from './useChatGenerationActions';
import type { GenerationDeps } from './useChatGenerationActions';
import { supersedeSyncedReplies } from '../../services/sync/supersedeSyncedReplies';
import { applicationFacade } from '../../services/applicationFacade';
import { requireWorkspaceConversationMessages } from '../../hooks/useApplicationProjection';
import { toWorkspaceMessage } from './types';

type SetState<T> = Dispatch<SetStateAction<T>>;

type RetryParams = {
  activeConversationId: string | null | undefined;
  setDebugInfo: SetState<any>;
};

/** Shared context for the retry-branch helpers (bundled so each stays within the param limit). */
type RetryCtx = { message: Message; genDeps: GenerationDeps; msgs: Message[] };

/** Retry from a USER message: read the turn's recorded modality BEFORE deleting the reply that
 *  carries it, so resend re-runs the SAME pipeline (deterministic) instead of re-classifying. */
async function retryFromUserMessage({ message, genDeps, msgs }: RetryCtx): Promise<void> {
  const idx = msgs.findIndex((m: Message) => m.id === message.id);
  if (idx !== -1) await replayPersistedChatTurnFn(genDeps, message);
}

/** Retry from an ASSISTANT message: regenerate the preceding user turn. Uses the SAME whole-turn
 *  recordedTurnKind (keyed on that user message) as the user-message path, so tapping resend on
 *  EITHER the enhanced-prompt or the image-result message of an image turn re-draws the image. */
async function retryFromAssistantMessage({ message, genDeps, msgs }: RetryCtx): Promise<void> {
  const idx = msgs.findIndex((m: Message) => m.id === message.id);
  const prev = idx > 0 ? msgs.slice(0, idx).reverse().find((m: Message) => m.role === 'user') ?? null : null;
  if (prev) await replayPersistedChatTurnFn(genDeps, prev);
}

export async function handleRetryMessageFn(
  message: Message, genDeps: GenerationDeps, p: RetryParams,
): Promise<void> {
  const msgs = p.activeConversationId
    ? requireWorkspaceConversationMessages(p.activeConversationId).map(toWorkspaceMessage)
    : [];
  if (!p.activeConversationId) return;
  // Stop any in-flight TTS before deleting messages (no-op without pro audio)
  callHook(HOOKS.audioStop);
  // A synced reply shows as a live preview until its op lands; clear it too, or resend duplicates it.
  supersedeSyncedReplies(p.activeConversationId);
  const ctx: RetryCtx = { message, genDeps, msgs };
  if (message.role === 'user') await retryFromUserMessage(ctx);
  else await retryFromAssistantMessage(ctx);
}

type EditParams = {
  message: Message;
  newContent: string;
  activeConversationId: string | null | undefined;
  setDebugInfo: SetState<any>;
};

async function editAssistantMessage(
  conversationId: string,
  message: Message,
  newContent: string,
): Promise<void> {
  const workspaceContent = applicationFacade().workspaceContent;
  const record = workspaceContent
    .snapshot()
    .messages.find(
      candidate =>
        candidate.id === message.id &&
        candidate.conversationId === conversationId,
    );
  if (!record || record.portable.role !== 'assistant') {
    throw new Error(`Assistant message not found: ${message.id}`);
  }
  const outcome = await workspaceContent.execute({
    type: 'update_message',
    messageId: record.id,
    portable: {
      ...record.portable,
      content: replacePortableMessageText(record.portable.content, newContent),
    },
  });
  if (!outcome.ok) throw new Error(outcome.failure.message);
}

export async function handleEditMessageFn(genDeps: GenerationDeps, p: EditParams): Promise<void> {
  if (!p.activeConversationId) return;
  if (p.message.role === 'assistant') {
    try {
      await editAssistantMessage(
        p.activeConversationId,
        p.message,
        p.newContent,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      genDeps.setAlertState(showAlert('Edit Error', message));
    }
    return;
  }
  // Same as resend: a synced reply is a live preview until its op lands, so clear it before regenerating.
  supersedeSyncedReplies(p.activeConversationId);
  // Shared ChatSession.edit is the sole durable writer; the edited content reaches the UI through
  // the reactive Workspace Content projection after commit, not a local mirror write here.
  await editPersistedChatTurnFn(genDeps, { ...p.message, content: p.newContent });
}

export function handleDeleteConversationFn(
  genDeps: GenerationDeps,
  p: { activeConversationId: string | null | undefined; activeConversation: any; setAlertState: SetState<AlertState> },
): void {
  if (!p.activeConversationId || !p.activeConversation) return;
  p.setAlertState(showAlert(
    'Delete Conversation',
    'Are you sure you want to delete this conversation? This will also delete all images generated in this chat.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { executeDeleteConversationFn(genDeps).catch(() => {}); } },
    ],
  ));
}

export async function handleGenerateImageFromMsgFn(
  prompt: string, genDeps: GenerationDeps,
  p: { activeConversationId: string | null | undefined; activeImageModel: any; setAlertState: SetState<AlertState> },
): Promise<void> {
  if (!p.activeConversationId || !p.activeImageModel) {
    p.setAlertState(showAlert('No Image Model', 'Please load an image model first from the Models screen.'));
    return;
  }
  await generateImageForPersistedTurnFn(genDeps, prompt, p.activeConversationId);
}
