import { Dispatch, SetStateAction } from 'react';
import {
  admitChatImageAttachment,
  memoryOverrideOffer,
  generationMessageText,
  ModelsFailureError,
  type ChatTurn,
  type GenerationOperation,
  type ModelsFailure,
  type Outcome,
  workflowFailureMessage,
} from '@offgrid/application';
import { AlertState, hideAlert, showAlert } from '../../components';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { mobileTextEngineControl } from '../../services/modelServices/textEngineControl';
import { applicationFacade } from '../../services/applicationFacade';
import { needsVisionRepair } from '../../utils/visionRepair';
import {
  clearModelFailure,
  reportModelFailure,
} from '../../services/modelFailureHandler';
import { generateId } from '../../utils/generateId';
import { mobileImageChatGeneration } from '../../services/modelServices/imageChatGenerationPort';
import {
  mobileChatRequestDefaults,
  mobileGenerationMessage,
  mobileWorkspaceGenerationMessage,
  withMobileChatCommandOptions,
} from '../../services/adapters/models/mobileChatHostPort';
import type {
  DownloadedModel,
  MediaAttachment,
  Message,
  Project,
  RemoteModel,
} from '../../types';
import logger from '../../utils/logger';
import type { ModelReadyOutcome } from './modelReadiness';
import {
  mobileChatSession,
  type MobileChatCommandOptions,
} from './mobileChatSession';
import { toWorkspaceMessage } from './types';
import { requireWorkspaceConversationMessages } from '../../hooks/useApplicationProjection';
import {
  createWorkspaceConversation,
  updateWorkspaceConversationProject,
} from './workspaceChatCommands';

export { appendWorkspaceAssistantMessage } from './workspaceChatCommands';

type SetState<T> = Dispatch<SetStateAction<T>>;

export type GenerationDeps = {
  activeModelId: string | null;
  activeModel: DownloadedModel | null | undefined;
  activeModelInfo?: {
    isRemote: boolean;
    model: DownloadedModel | RemoteModel | null;
    modelId: string | null;
    modelName: string;
  };
  conversationModelId: string | null;
  hasTextModel?: boolean;
  supportsToolCalling?: boolean;
  activeConversationId: string | null | undefined;
  activeConversation: any;
  activeProject: any;
  activeImageModel: any;
  imageModelLoaded: boolean;
  isStreaming: boolean;
  isGeneratingImage: boolean;
  imageGenState: { isGenerating: boolean };
  downloadedModels: DownloadedModel[];
  setAlertState: SetState<AlertState>;
  setIsClassifying: SetState<boolean>;
  clearStreamingMessage: () => void;
  setActiveConversation: (conversationId: string | null) => void;
  generatedImageIds: readonly string[];
  navigation: any;
  setShowSettingsPanel?: SetState<boolean>;
  ensureModelLoaded: () => Promise<ModelReadyOutcome>;
  forceLoadModel: () => Promise<ModelReadyOutcome>;
  ensureTextModelForChat: () => Promise<boolean>;
  setPendingMessage?: (text: string, attachments?: MediaAttachment[]) => void;
  pendingProjectId?: string;
};

function blockedImageForNonVisionModel(
  deps: GenerationDeps,
  attachments?: MediaAttachment[],
): boolean {
  const admission = admitChatImageAttachment({
    hasImage: !!attachments?.some(attachment => attachment.type === 'image'),
    remote: !!deps.activeModelInfo?.isRemote,
    localVisionReady: mobileTextEngineControl.acceptsImage(
      deps.activeModel?.id,
    ),
    visionRepairAvailable: needsVisionRepair(deps.activeModel),
  });
  if (admission.allowed) return false;
  const repair = admission.reason === 'vision-file-missing';
  deps.setAlertState(
    showAlert(
      repair ? 'Vision File Missing' : 'Vision Not Supported',
      repair
        ? 'This model supports vision, but its vision file has not been installed.\n\nOpen Download Manager and tap the wrench next to the model to download it.'
        : 'This model does not support image input.\n\nSwitch to a vision-capable model to send images.',
    ),
  );
  return true;
}

function mobileCommandOptions(
  deps: GenerationDeps,
  imageMode: MobileChatCommandOptions['imageMode'] = 'auto',
): MobileChatCommandOptions {
  return {
    imageMode,
    onClassifying: deps.setIsClassifying,
    ensureTextRoute: deps.ensureTextModelForChat,
  };
}

/** Projects the Shared memory-override offer and retries the refused turn. */
function offerRunAnyway(error: unknown, retry: () => Promise<void>): boolean {
  const offer = memoryOverrideOffer({
    modality: 'text',
    error,
    route: applicationFacade().models.snapshot().active.text?.model,
  });
  if (!offer) return false;
  reportModelFailure('text', error, {
    id: 'chat-text-load',
    memoryPressure: true,
    overridable: true,
    onLoadAnyway: () => {
      applicationFacade()
        .models.load({
          modality: offer.modality,
          modelId: offer.modelId,
          override: true,
        })
        .then(outcome => {
          if (!outcome.ok) throw outcome.failure;
          clearModelFailure('text');
          return retry();
        })
        .catch(cause =>
          reportModelFailure('text', cause, { id: 'chat-text-load' }),
        );
    },
  });
  return true;
}

type GenerationFailure = {
  error: unknown;
  retry?: () => Promise<void>;
  turnId?: string;
};

function presentGenerationError(
  deps: GenerationDeps,
  conversationId: string,
  { error, retry, turnId }: GenerationFailure,
): void {
  const message =
    error instanceof Error
      ? error.message
      : String(error || 'Failed to generate response');
  logger.error('[ChatGen] Generation failed', {conversationId, error});
  // The refusal is shown once: the failure card carries the reason and the Run anyway action, so the
  // same text is not also written into the conversation.
  if (retry && offerRunAnyway(error, retry)) return;
  const contextFull =
    message.includes('too long') ||
    message.includes('Exceeding the maximum number of tokens') ||
    message.includes('Input token ids');
  if (contextFull) {
    // The source conversation is read from the canonical projection - not the legacy Zustand
    // mirror, which a Shared-created conversation never populates.
    const sourceProjectId = deps.activeConversation?.projectId;
    const modelId =
      deps.activeModelInfo?.modelId ??
      deps.activeModel?.id ??
      deps.activeImageModel?.id;
    deps.setAlertState({
      ...showAlert(
        'Context window full',
        "The conversation is too long for this model's context window.\n\nIncrease the context limit in Settings, reduce the number of enabled tools, or start a new chat.",
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'New chat',
            onPress: () => {
              if (!modelId) return;
              createWorkspaceConversation(deps, {
                modelId,
                projectId: sourceProjectId,
              })
                .then(nextId => {
                  deps.setActiveConversation(nextId);
                  deps.setAlertState(hideAlert());
                })
                .catch(() => undefined);
            },
          },
        ],
      ),
      prominentMessage: true,
    });
    return;
  }
  const failureBelongsToTurn = Boolean(
    turnId &&
      applicationFacade()
        .workspaceContent.snapshot()
        .chatTurns.some(
          turn => turn.id === turnId && turn.status === 'failed',
        ),
  );
  deps.setAlertState(
    showAlert(
      'Generation Error',
      failureBelongsToTurn
        ? 'The model could not complete this response. The failure is shown in the chat.'
        : message,
    ),
  );
}

type StartGenerationCall = {
  setDebugInfo: SetState<any>;
  targetConversationId: string;
  /** The durable turn identity, already committed through Workspace Content's `append_message`. */
  turnId: string;
  /** The distinct durable identity of the already-committed user message. */
  userMessageId: string;
  /** The final assistant row and its live audio use this one identity. */
  assistantMessageId: string;
  userMessage: ReturnType<typeof mobileGenerationMessage>;
  projectId?: string;
  imageMode?: 'auto' | 'force' | 'disabled';
};

function requireChatTurn(outcome: Outcome<ChatTurn, ModelsFailure>): ChatTurn {
  if (!outcome.ok) throw new ModelsFailureError(outcome.failure);
  return outcome.value;
}

/** Runs an already-persisted Workspace Content turn without a legacy-store dependency. */
async function runPersistedChatTurnFn(
  deps: GenerationDeps,
  call: StartGenerationCall,
): Promise<void> {
  const recordedOperation: GenerationOperation | undefined =
    call.imageMode === 'force'
      ? { type: 'image', prompt: generationMessageText(call.userMessage) }
      : call.imageMode === 'disabled'
      ? { type: 'text' }
      : undefined;
  try {
    const turn = await withMobileChatCommandOptions(
      call.turnId,
      mobileCommandOptions(deps, call.imageMode),
      async () =>
        requireChatTurn(
          await applicationFacade().models.chat.send({
            conversationId: call.targetConversationId,
            turnId: call.turnId,
            userMessageId: call.userMessageId,
            assistantMessageId: call.assistantMessageId,
            projectId: call.projectId,
            userMessage: call.userMessage,
            operation: recordedOperation,
            request: mobileChatRequestDefaults(),
          }),
        ),
    );
    // An intentional stop can complete with no assistant row. That is the
    // expected terminal state, not a model failure.
    if (turn.status === 'stopped') return;
  } catch (error) {
    presentGenerationError(deps, call.targetConversationId, {
      error,
      turnId: call.turnId,
      retry: async () => {
        const persistedMessage = applicationFacade()
          .workspaceContent.snapshot()
          .messages.find(
            message =>
              message.id === call.userMessageId &&
              message.conversationId === call.targetConversationId,
          );
        if (!persistedMessage) return;
        await replayPersistedChatTurnFn(
          deps,
          toWorkspaceMessage(persistedMessage),
          recordedOperation,
        );
      },
    });
  }
}

export type SendCall = {
  text: string;
  attachments?: MediaAttachment[];
  imageMode?: 'auto' | 'force' | 'disabled';
  setDebugInfo: SetState<any>;
  /** Legacy test input. Shared ChatSessionService owns execution. */
  startGeneration?: (conversationId: string, text: string) => Promise<void>;
};

export async function handleSendFn(
  deps: GenerationDeps,
  call: SendCall,
): Promise<void> {
  if (!deps.conversationModelId) {
    deps.setAlertState(
      showAlert('No Model Selected', 'Please select a model first.'),
    );
    return;
  }
  if (blockedImageForNonVisionModel(deps, call.attachments)) return;
  // A failure card describes the previous text attempt. Once a new accepted
  // attempt starts, that stale projection must not sit beside the live stream.
  clearModelFailure('text');
  callHook(HOOKS.audioStop);
  // No text-model readiness here. The shared ChatOperationApplicationService decides whether this
  // turn is text or image and asks for the text route (ensureTextRoute) only when it needs one;
  // the shared residency then loads the model on acquire. Pre-loading here loaded the text model
  // for every "draw a ..." before the shared service had routed it to the image model.
  let conversationId = deps.activeConversationId;
  let projectId = deps.activeConversation?.projectId;
  if (!conversationId) {
    conversationId = await createWorkspaceConversation(deps, {
      modelId: deps.conversationModelId,
      title: call.text,
    });
    projectId = deps.pendingProjectId;
    deps.setActiveConversation(conversationId);
  }
  const messageId = generateId();
  const turnId = generateId();
  const assistantMessageId = generateId();
  const userMessage = mobileGenerationMessage({
    id: messageId,
    uuid: messageId,
    role: 'user',
    content: call.text,
    timestamp: Date.now(),
    attachments: call.attachments,
  } as Message);
  await runPersistedChatTurnFn(deps, {
    setDebugInfo: call.setDebugInfo,
    targetConversationId: conversationId,
    turnId,
    userMessageId: messageId,
    assistantMessageId,
    userMessage,
    projectId,
    imageMode: call.imageMode,
  });
}

export async function replayPersistedChatTurnFn(
  deps: GenerationDeps,
  userMessage: Message,
  operation?:
    | { type: 'image'; prompt: string }
    | { type: 'text' }
    | { type: 'vision' },
): Promise<void> {
  const conversationId = deps.activeConversationId;
  if (!conversationId) return;
  if (blockedImageForNonVisionModel(deps, userMessage.attachments)) return;
  const workspaceContent = applicationFacade().workspaceContent.snapshot();
  const persistedMessage = workspaceContent.messages.find(
    message =>
      message.id === userMessage.id &&
      message.conversationId === conversationId,
  );
  if (!persistedMessage) return;
  if (persistedMessage.turnId === null) {
    const conversation = workspaceContent.conversations.find(
      candidate => candidate.id === conversationId,
    );
    await runPersistedChatTurnFn(deps, {
      setDebugInfo: () => undefined,
      targetConversationId: conversationId,
      turnId: generateId(),
      userMessageId: persistedMessage.id,
      assistantMessageId: generateId(),
      userMessage: mobileWorkspaceGenerationMessage(persistedMessage),
      projectId: conversation?.projectId ?? undefined,
      imageMode:
        operation?.type === 'image'
          ? 'force'
          : operation?.type === 'text'
          ? 'disabled'
          : 'auto',
    });
    return;
  }
  try {
    await mobileChatSession.regenerate(
      conversationId,
      persistedMessage.turnId,
      {
        operation,
        options: mobileCommandOptions(deps),
      },
    );
  } catch (error) {
    presentGenerationError(deps, conversationId, {
      error,
      turnId: persistedMessage.turnId,
      retry: () => replayPersistedChatTurnFn(deps, userMessage, operation),
    });
  }
}

export async function editPersistedChatTurnFn(
  deps: GenerationDeps,
  message: Message,
): Promise<void> {
  const conversationId = deps.activeConversationId;
  if (!conversationId) return;
  let turnId: string | undefined;
  try {
    const persistedMessage = applicationFacade()
      .workspaceContent.snapshot()
      .messages.find(
        candidate =>
          candidate.id === message.id &&
          candidate.conversationId === conversationId,
      );
    if (!persistedMessage?.turnId) {
      throw new Error(`Chat turn not found for message: ${message.id}`);
    }
    turnId = persistedMessage.turnId;
    await mobileChatSession.edit(
      conversationId,
      persistedMessage.turnId,
      message,
      mobileCommandOptions(deps),
    );
  } catch (error) {
    presentGenerationError(deps, conversationId, {
      error,
      turnId,
      retry: () => editPersistedChatTurnFn(deps, message),
    });
  }
}

export async function generateImageForPersistedTurnFn(
  deps: GenerationDeps,
  prompt: string,
  conversationId: string,
): Promise<void> {
  const message = requireWorkspaceConversationMessages(conversationId)
    .map(toWorkspaceMessage)
    .reverse()
    .find(candidate => candidate.role === 'user');
  if (!message) return;
  await replayPersistedChatTurnFn(deps, message, { type: 'image', prompt });
}

export async function handleStopFn(
  deps: Pick<GenerationDeps, 'activeConversationId'>,
): Promise<void> {
  const before = mobileChatSession.snapshot();
  logger.log(
    `[CHAT-STOP] requested running=${before.entries.filter(entry => entry.status === 'running').length} ` +
      `queued=${before.entries.filter(entry => entry.status === 'queued').length}`,
  );
  callHook(HOOKS.audioStop);
  const stopped = deps.activeConversationId
    ? mobileChatSession.stopConversation(deps.activeConversationId)
    : 0;
  logger.log(
    `[CHAT-STOP] chat cancellations=${stopped} ` +
      `entries=${before.entries
        .map(entry => `${entry.turnId}:${entry.status}`)
        .join(',') || 'none'}`,
  );
}

export async function executeDeleteConversationFn(
  deps: Pick<
    GenerationDeps,
    | 'activeConversationId'
    | 'isStreaming'
    | 'clearStreamingMessage'
    | 'setActiveConversation'
    | 'navigation'
    | 'setAlertState'
  >,
): Promise<void> {
  if (!deps.activeConversationId) return;
  const conversationId = deps.activeConversationId;
  deps.setAlertState(hideAlert());
  if (deps.isStreaming) {
    mobileChatSession.stopConversation(conversationId);
    deps.clearStreamingMessage();
  }
  try {
    await mobileImageChatGeneration.clearConversationSummary(conversationId);
    const outcome = await applicationFacade().workflows.deleteConversation(
      conversationId,
    );
    if (!outcome.ok) {
      deps.setAlertState(
        showAlert(
          'Conversation Not Deleted',
          workflowFailureMessage(outcome.failure),
        ),
      );
      return;
    }
  } catch (error) {
    deps.setAlertState(
      showAlert(
        'Conversation Not Deleted',
        error instanceof Error ? error.message : String(error),
      ),
    );
    return;
  }
  deps.setActiveConversation(null);
  deps.navigation.goBack();
}

export type SelectProjectDeps = {
  activeConversationId: string | null | undefined;
  setShowProjectSelector: SetState<boolean>;
};

export function handleSelectProjectFn(
  deps: SelectProjectDeps,
  project: Project | null,
): void {
  if (deps.activeConversationId) {
    updateWorkspaceConversationProject(
      deps.activeConversationId,
      project?.id ?? null,
    ).catch(() => undefined);
  }
  deps.setShowProjectSelector(false);
}
