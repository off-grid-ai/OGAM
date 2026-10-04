import { Dispatch, SetStateAction } from 'react';
import { showAlert, AlertState } from '../../components';
import { Message } from '../../types';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import {
  editPersistedChatTurnFn,
  executeDeleteConversationFn,
  generateImageForPersistedTurnFn,
  replayPersistedChatTurnFn,
} from './useChatGenerationActions';
import type { GenerationDeps } from './useChatGenerationActions';
import { supersedeSyncedReplies } from '../../services/sync/supersedeSyncedReplies';
import { requireWorkspaceConversationMessages } from '../../hooks/useApplicationProjection';
import { toWorkspaceMessage } from './types';

type SetState<T> = Dispatch<SetStateAction<T>>;

type RetryParams = {
  activeConversationId: string | null | undefined;
  hasActiveModel: boolean;
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
  // No model loaded (e.g. user ejected all models): tell them, don't silently
  // no-op. Mirrors the send path's "No Model Selected" alert (handleSendFn).
  if (!p.hasActiveModel) { genDeps.setAlertState(showAlert('No Model Selected', 'Please select a model first.')); return; }
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
  hasActiveModel: boolean;
  setDebugInfo: SetState<any>;
};

export async function handleEditMessageFn(genDeps: GenerationDeps, p: EditParams): Promise<void> {
  // Same as retry: no model loaded → alert instead of a silent no-op.
  if (!p.hasActiveModel) { genDeps.setAlertState(showAlert('No Model Selected', 'Please select a model first.')); return; }
  if (!p.activeConversationId) return;
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
