import { Dispatch, SetStateAction } from 'react';
import { showAlert, AlertState } from '../../components';
import { Message } from '../../types';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import logger from '../../utils/logger';
import { modelResidencyManager } from '../../services/modelResidency';
import { hardwareService } from '../../services/hardware';
import {
  regenerateResponseFn, executeDeleteConversationFn, handleImageGenerationFn,
  recordedTurnKind,
} from './useChatGenerationActions';
import type { GenerationDeps } from './useChatGenerationActions';
import { supersedeSyncedReplies } from '../../services/sync/supersedeSyncedReplies';
import { useChatStore } from '../../stores/chatStore';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { enableAssistantTools } from '../../services/tools/useExtensionToolCount';
import type { MediaAttachment } from '../../types';
import RNFS from 'react-native-fs';
import { useWhisperStore } from '../../stores/whisperStore';
import { whisperService } from '../../services/whisperService';
import { activeModelService } from '../../services/activeModelService';
import { ensureWhisperForTranscription } from '../../components/ChatInput/ensureWhisperForTranscription';
import { resolveDocumentPath } from '../../utils/resolveDocumentPath';
import { shownMessages } from '../../utils/chatThread';

type SetState<T> = Dispatch<SetStateAction<T>>;

type RetryParams = {
  assistantEnabled?: boolean;
  activeConversationId: string | null | undefined;
  hasActiveModel: boolean;
  deleteMessagesAfter: (c: string, m: string) => void;
  setDebugInfo: SetState<any>;
};

/** Shared context for the retry-branch helpers (bundled so each stays within the param limit). */
type RetryCtx = { message: Message; genDeps: GenerationDeps; p: RetryParams; convId: string; msgs: Message[] };

/** Regenerate `userMessage`'s answer as a new version beside `answer` (when it has one): the old
 *  answer and the turns after it stay a version the person can go back to. Nothing is deleted. */
async function regenerateAsVersion(
  genDeps: GenerationDeps,
  p: RetryParams,
  convId: string,
  userMessage: Message,
  answer: Message | undefined,
  recordedKind: ReturnType<typeof recordedTurnKind>,
): Promise<void> {
  const store = useChatStore.getState();
  if (answer) store.prepareAnswerVersion(convId, answer);
  try {
    await regenerateResponseFn(genDeps, { setDebugInfo: p.setDebugInfo, userMessage, recordedKind, assistantEnabled: p.assistantEnabled });
  } finally {
    // A retry that saved no answer leaves the chat as it was.
    useChatStore.getState().clearPendingVersion(convId);
  }
}

/** The answer shown after `userMessage` in the chat, if any. */
const answerAfter = (msgs: Message[], userMessage: Message): Message | undefined => {
  const idx = msgs.findIndex((m: Message) => m.id === userMessage.id);
  return idx === -1 ? undefined : msgs.slice(idx + 1).find(m => m.role === 'assistant' && !m.isSystemInfo);
};

/** Retry from a USER message (resend): read the turn's recorded modality first, so resend re-runs
 *  the SAME pipeline (deterministic) instead of re-classifying. */
async function retryFromUserMessage({ message, genDeps, p, convId, msgs }: RetryCtx): Promise<void> {
  const recordedKind = recordedTurnKind(msgs, message.id);
  const answer = answerAfter(msgs, message);
  logger.log(`[RESEND-SM] retry user msg answer=${answer?.id ?? 'none'} recordedKind=${recordedKind ?? 'none'}`);
  await regenerateAsVersion(genDeps, p, convId, message, answer, recordedKind);
}

/** Retry from an ASSISTANT message: regenerate the preceding user turn. Uses the SAME whole-turn
 *  recordedTurnKind (keyed on that user message) as the user-message path, so tapping resend on
 *  EITHER the enhanced-prompt or the image-result message of an image turn re-draws the image. */
async function retryFromAssistantMessage({ message, genDeps, p, convId, msgs }: RetryCtx): Promise<void> {
  const idx = msgs.findIndex((m: Message) => m.id === message.id);
  const prev = idx > 0 ? msgs.slice(0, idx).reverse().find((m: Message) => m.role === 'user') ?? null : null;
  const recordedKind = prev ? recordedTurnKind(msgs, prev.id) : undefined;
  logger.log(`[RESEND-SM] retry assistant msg idx=${idx} prevUser=${prev?.id ?? 'none'} recordedKind=${recordedKind ?? 'none'}`);
  if (prev) await regenerateAsVersion(genDeps, p, convId, prev, answerAfter(msgs, prev), recordedKind);
}

export async function handleRetryMessageFn(
  message: Message, genDeps: GenerationDeps, p: RetryParams,
): Promise<void> {
  // The chat as shown: retry acts on the versions in view.
  const msgs = p.activeConversationId
    ? shownMessages(useChatStore.getState().getConversationMessages(p.activeConversationId))
    : [];
  // Memory breakdown at the crash-prone moment: the JetsamEvent shows the app
  // hitting the ~2GB per-process limit, but not WHAT's resident. Dump it so we see
  // whether an un-evicted model (image?) or a leak is eating the budget.
  try {
    const residents = modelResidencyManager.getResidents().map(r => `${r.type}:${r.sizeMB}MB`).join(',');
    logger.log(`[MEM-SM] resend: residents=[${residents}] availMB=${Math.round(hardwareService.getAvailableMemoryGB() * 1024)} totalMB=${Math.round(hardwareService.getTotalMemoryGB() * 1024)}`);
  } catch { /* diagnostics only */ }
  logger.log(`[RESEND-SM] retry msg role=${message.role} id=${message.id} hasActiveModel=${p.hasActiveModel} conv=${p.activeConversationId} totalMsgs=${msgs.length}`);
  // No model loaded (e.g. user ejected all models): tell them, don't silently
  // no-op. Mirrors the send path's "No Model Selected" alert (handleSendFn).
  if (!p.hasActiveModel) { logger.log('[RESEND-SM] retry BAIL: no active model'); genDeps.setAlertState(showAlert('No Model Selected', 'Please select a model first.')); return; }
  if (!p.activeConversationId) { logger.log('[RESEND-SM] retry BAIL: no conv'); return; }
  // Retry does not go through the composer button. Re-apply its tool selection before deleting the
  // old reply, so a selected Assistant never silently resends with only the other enabled tools.
  if (p.assistantEnabled && !enableAssistantTools()) {
    logger.log('[RESEND-SM] retry BAIL: assistant task tools unavailable');
    genDeps.setAlertState(showAlert('Assistant unavailable', 'Connect an active Desktop to use Assistant tools, then retry.'));
    return;
  }
  // Stop any in-flight TTS before deleting messages (no-op without pro audio)
  callHook(HOOKS.audioStop);
  // A synced reply shows as a live preview until its op lands; clear it too, or resend duplicates it.
  supersedeSyncedReplies(p.activeConversationId);
  const ctx: RetryCtx = { message, genDeps, p, convId: p.activeConversationId, msgs };
  if (message.role === 'user') await retryFromUserMessage(ctx);
  else await retryFromAssistantMessage(ctx);
}

type EditParams = {
  message: Message;
  newContent: string;
  activeConversationId: string | null | undefined;
  hasActiveModel: boolean;
  updateMessageContent: (c: string, m: string, v: string) => void;
  deleteMessagesAfter: (c: string, m: string) => void;
  setDebugInfo: SetState<any>;
};

export async function handleEditMessageFn(genDeps: GenerationDeps, p: EditParams): Promise<void> {
  if (!p.activeConversationId) return;
  const store = useChatStore.getState();
  if (p.message.role === 'assistant') {
    // An edited answer is a new version of it; the original stays.
    const { id: _id, timestamp: _timestamp, uuid: _uuid, threadVersions: _versions, parent: _parent, selectedAt: _selectedAt, ...rest } = p.message;
    store.addMessageVersion(p.activeConversationId, p.message, { ...rest, content: p.newContent });
    return;
  }
  // Same as retry: no model loaded → alert instead of a silent no-op.
  if (!p.hasActiveModel) { genDeps.setAlertState(showAlert('No Model Selected', 'Please select a model first.')); return; }
  // Same as resend: a synced reply is a live preview until its op lands, so clear it before regenerating.
  supersedeSyncedReplies(p.activeConversationId);
  // Preserve the turn's modality across an edit: an edited image prompt re-runs the image pipeline,
  // not a re-classification.
  const messages = shownMessages(store.getConversationMessages(p.activeConversationId));
  const recordedKind = recordedTurnKind(messages, p.message.id);
  // The edited question is a new version beside the old one, which keeps its answers and later turns.
  const attachments = p.message.attachments?.map(attachment =>
    attachment.type === 'audio' ? { ...attachment, textContent: p.newContent } : attachment,
  );
  const edited = store.addMessageVersion(p.activeConversationId, p.message, {
    role: 'user',
    content: p.newContent,
    ...(attachments ? { attachments } : {}),
    ...(p.message.turnKind ? { turnKind: p.message.turnKind } : {}),
  });
  if (!edited) return;
  await regenerateResponseFn(genDeps, { setDebugInfo: p.setDebugInfo, userMessage: edited, recordedKind });
}

export async function handleTranscribeAgainFn(p: {
  message: Message;
  attachment: MediaAttachment;
  activeConversationId: string | null | undefined;
  updateMessageTranscription: (
    conversationId: string,
    messageId: string,
    attachmentId: string,
    transcription: string,
  ) => void;
  setAlertState: SetState<AlertState>;
}): Promise<void> {
  if (!p.activeConversationId) return;
  const path = resolveDocumentPath(p.attachment.uri);
  if (!path || !(await RNFS.exists(path).catch(() => false))) {
    p.setAlertState(
      showAlert('Audio unavailable', 'This voice message is no longer on this device.'),
    );
    return;
  }

  try {
    const remote = useRemoteServerStore
      .getState()
      .getActiveRemoteMediaServer('transcription');
    if (!remote?.mediaModels?.transcription) {
      const whisper = useWhisperStore.getState();
      const ready = await ensureWhisperForTranscription({
        isSelectedModelLoaded: () =>
          !!whisper.downloadedModelId &&
          whisperService.getLoadedModelPath() ===
            whisperService.getModelPath(whisper.downloadedModelId),
        hasDownloadedModel: () => !!whisper.downloadedModelId,
        loadWhisper: () => useWhisperStore.getState().loadModel(),
        freeGenerationModels: () =>
          activeModelService.unloadAllModels(true).then(() => {}),
      });
      if (!ready) {
        p.setAlertState(
          showAlert(
            'Speech model unavailable',
            'Download a speech model in Models, then try again.',
          ),
        );
        return;
      }
    }

    const transcription = (
      await whisperService.transcribeFile(path, {
        language: useWhisperStore.getState().transcriptionLanguage,
      })
    ).trim();
    if (!transcription) {
      p.setAlertState(
        showAlert('No speech found', 'The audio did not contain clear speech.'),
      );
      return;
    }
    p.updateMessageTranscription(
      p.activeConversationId,
      p.message.id,
      p.attachment.id,
      transcription,
    );
  } catch (error) {
    logger.error('[Voice] Failed to transcribe saved message:', error);
    p.setAlertState(
      showAlert('Transcription failed', 'The voice message could not be transcribed.'),
    );
  }
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
  await handleImageGenerationFn(genDeps, { prompt, conversationId: p.activeConversationId, skipUserMessage: true });
}
