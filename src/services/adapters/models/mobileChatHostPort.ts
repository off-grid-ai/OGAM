import {
  DEFAULT_IMAGE_MIME,
  generationMessageText,
  isMemoryToolAllowed,
  runtimeModelRouteId,
  type ChatContextApplicationPorts,
  type ChatGenerationPort,
  type ChatOperationApplicationPorts,
  type ChatOperationCommand,
  type ChatOperationPolicyPort,
  type ChatQueueProjection,
  type ChatRagPort,
  type ChatSessionEvent,
  type ChatSessionServiceOptions,
  type GenerationEvents,
  type GenerationMessage,
  type GenerationOperation,
  type GenerationRequest,
  type GenerationResult,
  type MessageRecord,
} from '@offgrid/application';
import { Platform } from 'react-native';
import type {
  CompactableGenerationMessage,
  ContextCompactionService,
  GenerationIntentService,
} from '@offgrid/models';
import { describeImageBackend } from '@offgrid/models';
import { voiceModeSystemPrompt } from '@offgrid/speech';
import {
  generationMessage,
  mobileWorkspaceGenerationMessage,
} from './mobileChatTurnRepository';
import { committedEnabledToolIds } from './committedToolSelection';
import { generateChatWithModelsFacade } from './modelsFacadeGeneration';
import { useAppStore } from '../../../stores';
import type { MediaAttachment, Message } from '../../../types';
import logger from '../../../utils/logger';
import { applicationFacade } from '../../applicationFacade';
import { ensureDefaultClassifier } from '../../classifierProvisioning';
import { mobileChatGenerationProjection } from '../../chatGenerationProjection';
import { mobileCompactionOptions } from '../../contextCompactionPorts';
import {
  classifyMobileIntent,
  configuredClassifierModel,
} from '../../intentClassifierPorts';
import { reportModelFailure } from '../../modelFailureHandler';
import { modelInputAudioUris } from '../../modelMedia';
import { requireRagSuccess } from '../../ragOutcome';
import { mobileImageChatGeneration } from '../../modelServices/imageChatGenerationPort';
import { activeMobileRoute } from '../../modelServices/mobileLLMService';
import { lifecycleProjectionPort } from '../../modelServices/lifecycleProjectionPort';
import { mobileToolDefinitions } from '../../modelServices/toolPorts';
import {
  committedModelSettings,
  committedSystemPrompt,
  optionalNumberSetting,
} from './mobileChatSettingsProjection';
import {projectWorkspaceMessage} from '../workspaceContent/projectWorkspaceMessage';

export { mobileChatRequestDefaults } from './mobileChatSettingsProjection';

export interface MobileChatCommandOptions {
  imageMode?: 'auto' | 'force' | 'disabled';
  onClassifying?: (active: boolean) => void;
  onClassifierStatus?: (status: string | null) => void;
  onClassifierTextFallback?: () => void;
  ensureTextRoute?: () => Promise<boolean>;
}

const commandOptions = new Map<string, MobileChatCommandOptions>();
let queue: ChatQueueProjection = {
  entries: [],
  runningCount: 0,
  queuedCount: 0,
};
const queueListeners = new Set<(projection: ChatQueueProjection) => void>();
const sessionEventListeners = new Set<(event: ChatSessionEvent) => void>();

export function mobileGenerationMessage(message: Message): GenerationMessage {
  return generationMessage(message);
}

export { mobileWorkspaceGenerationMessage };

export async function withMobileChatCommandOptions<T>(
  turnId: string,
  options: MobileChatCommandOptions,
  run: () => Promise<T>,
): Promise<T> {
  commandOptions.set(turnId, options);
  try {
    return await run();
  } finally {
    commandOptions.delete(turnId);
  }
}

export const mobileChatQueueSnapshot = (): ChatQueueProjection => queue;
export function subscribeMobileChatQueue(
  listener: (projection: ChatQueueProjection) => void,
): () => void {
  queueListeners.add(listener);
  return () => queueListeners.delete(listener);
}
export function subscribeMobileChatSessionEvents(
  listener: (event: ChatSessionEvent) => void,
): () => void {
  sessionEventListeners.add(listener);
  return () => sessionEventListeners.delete(listener);
}
type ClassifierFailureStage = 'provisioning' | 'classification';

export function projectClassifierFailure(
  stage: ClassifierFailureStage,
  error: unknown,
): void {
  logger.warn(
    `[ChatSession] Intent classifier ${stage} failed; using the selected text route`,
    error,
  );
  reportModelFailure('text', error, {
    severity: 'warning',
    id: 'mobile-chat-classifier',
    title: 'Automatic routing is unavailable',
    message: 'Off Grid will use the selected text model for this message.',
  });
}

/** The composition root passes the composed intent service; this module stays port-only. */
export function mobileChatOperationPorts(
  intent: GenerationIntentService,
): ChatOperationApplicationPorts {
  return {
    inspect() {
      // Both routing facts are committed settings, so they are read from the canonical record - not
      // from an app-store slice a remote or sync-applied patch may not have reached yet.
      const settings = committedModelSettings();
      const facts = {
        imageEnabled: true,
        imageGenerationRunning: mobileImageChatGeneration.isGenerating(),
        imageRoutingMode:
          settings.imageGenerationMode === 'manual'
            ? ('manual' as const)
            : ('auto' as const),
        imageRouteAvailable: !!activeMobileRoute('image').model,
        textRouteAvailable: !!activeMobileRoute('text').model,
        modelAutoDetection: settings.autoDetectMethod === 'llm',
        dedicatedClassifierAvailable: !!configuredClassifierModel(),
      };
      logger.log(`[ROUTE-SM] facts ${JSON.stringify(facts)}`);
      return facts;
    },
    provisionClassifier: () => {
      ensureDefaultClassifier().catch(error =>
        projectClassifierFailure('provisioning', error),
      );
    },
    classify(text, input) {
      return classifyMobileIntent(intent, text, {
        useLLM: input.useModel,
        classifierModel: configuredClassifierModel(),
        onStatusChange: input.onStatusChange,
      });
    },
    refreshRoutes: async () => {
      await lifecycleProjectionPort.refreshInventory();
    },
    onClassificationError: error =>
      projectClassifierFailure('classification', error),
  };
}

export function mobileChatOperationCommand(input: {
  userMessage: GenerationMessage;
  requestedOperation?: GenerationOperation;
  signal: AbortSignal;
  identity: { turnId: string };
}): ChatOperationCommand {
  const options = commandOptions.get(input.identity.turnId);
  const hasImage =
    Array.isArray(input.userMessage.content) &&
    input.userMessage.content.some(part => part.type === 'image');
  return {
    text: generationMessageText(input.userMessage),
    hasImage,
    requestedOperation: input.requestedOperation,
    imageMode: options?.imageMode,
    onClassifying: options?.onClassifying,
    onClassifierStatus: options?.onClassifierStatus,
    onClassifierTextFallback: options?.onClassifierTextFallback,
    ensureTextRoute: options?.ensureTextRoute,
  };
}

function workspaceMessage(record: MessageRecord): Message {
  return projectWorkspaceMessage(record);
}

export function mobileChatContextPorts(): ChatContextApplicationPorts {
  return {
    conversation: id => {
      const snapshot = applicationFacade().workspaceContent.snapshot();
      const conversation = snapshot.conversations.find(
        candidate => candidate.id === id,
      );
      if (!conversation) return null;
      return {
        messages: snapshot.messages
          .filter(message => message.conversationId === id)
          .map(workspaceMessage),
        ...(conversation.compactionSummary === undefined
          ? {}
          : { compactionSummary: conversation.compactionSummary }),
        ...(conversation.compactionCutoffMessageId === undefined
          ? {}
          : {
              compactionCutoffMessageId: conversation.compactionCutoffMessageId,
            }),
      };
    },
    project: id =>
      applicationFacade()
        .workspaceContent.snapshot()
        .projects.find(project => project.id === id) ?? null,
    defaultSystemPrompt: committedSystemPrompt,
    augmentSystemPrompt: prompt =>
      voiceModeSystemPrompt(
        prompt,
        applicationFacade().speech.snapshot().preferences.voiceMode,
      ),
    async enabledDocumentNames(projectId) {
      return requireRagSuccess(
        await applicationFacade().rag.listDocuments(projectId),
      )
        .filter(document => document.enabled)
        .map(document => document.name);
    },
    async retrieve(projectId, query) {
      return (
        requireRagSuccess(
          await applicationFacade().rag.buildContext(projectId, query),
        ) || undefined
      );
    },
    audioUris: attachment =>
      modelInputAudioUris([attachment as MediaAttachment]),
    onRetrievalError: error =>
      logger.error('[ChatSession] RAG augmentation failed', error),
  };
}

async function publishSessionEvent(event: ChatSessionEvent): Promise<void> {
  sessionEventListeners.forEach(listener => listener(event));
  await mobileChatGenerationProjection.publish(event);
  if (event.type === 'queue_changed') {
    queue = event.queue;
    queueListeners.forEach(listener => listener(queue));
  }
}

async function generateForSession(
  request: GenerationRequest,
  events: GenerationEvents = {},
): Promise<GenerationResult> {
  if (request.operation?.type !== 'image') {
    await lifecycleProjectionPort.refreshInventory();
    return generateChatWithModelsFacade(request, events);
  }
  const identity = request.identity;
  if (!identity?.conversationId)
    throw new Error('Image generation requires a conversation identity');
  await lifecycleProjectionPort.refreshInventory();
  const startedAt = Date.now();
  const abort = () => {
    mobileImageChatGeneration.cancel().catch(() => undefined);
  };
  request.signal?.addEventListener('abort', abort, { once: true });
  try {
    const generated = await mobileImageChatGeneration.generate({
      prompt: request.operation.prompt,
      routeId: request.routeId,
      negativePrompt: request.operation.negativePrompt,
      steps: request.operation.steps,
      guidanceScale: request.operation.guidanceScale,
      seed: request.operation.seed,
      previewInterval: request.operation.previewInterval,
      conversationId: identity.conversationId,
    });
    if (!generated) {
      throw new Error(
        mobileImageChatGeneration.lastError() ??
          'Image generation returned no image',
      );
    }
    const model =
      (request.routeId
        ? applicationFacade().models.lookup(request.routeId)
        : null) ?? activeMobileRoute('image').model;
    if (!model) throw new Error('The selected image model is unavailable');
    const routeId = model.routeId ?? runtimeModelRouteId(model);
    // The SAME canonical record every other read on this path uses. `models.snapshot().settings` is
    // a projected copy of it; reading the record two ways left one fact with two readers.
    const settings = committedModelSettings();
    const useOpenCL = settings.imageUseOpenCL;
    const guidanceScale =
      request.operation.guidanceScale ??
      optionalNumberSetting(settings, 'imageGuidanceScale');
    const localImageModel = useAppStore
      .getState()
      .downloadedImageModels.find(candidate => candidate.id === model.id);
    return {
      model,
      output: {
        type: 'image',
        images: [
          {
            id: generated.id,
            mimeType: DEFAULT_IMAGE_MIME,
            uri: `file://${generated.imagePath}`,
            width: generated.width,
            height: generated.height,
            seed: generated.seed,
            local: {
              generationTimeMs: Date.now() - startedAt,
              generationMeta: {
                ...(typeof useOpenCL === 'boolean'
                  ? describeImageBackend(
                      Platform.OS,
                      model.source === 'remote'
                        ? 'remote'
                        : localImageModel?.backend,
                      useOpenCL,
                    )
                  : {}),
                modelName: model.name,
                steps: generated.steps,
                ...(guidanceScale === undefined ? {} : { guidanceScale }),
                resolution: `${generated.width}x${generated.height}`,
              },
            },
          },
        ],
      },
      content: '',
      reasoning: '',
      toolCalls: [],
      finishReason: 'stop',
      attemptedModelIds: [model.id],
      attemptedRouteIds: [routeId],
    };
  } finally {
    request.signal?.removeEventListener('abort', abort);
  }
}

export function mobileChatSessionPorts(
  rag: ChatRagPort,
  operation: ChatOperationPolicyPort,
  compaction: ContextCompactionService<CompactableGenerationMessage>,
): [ChatGenerationPort, ChatSessionServiceOptions] {
  return [
    { generate: generateForSession },
    {
      rag,
      tools: {
        resolve: async ({ identity }) => {
          // The committed tool selection has one owner: the Shared Models settings record. The chat
          // path must resolve tools from the same value the Tools screen commits, never from a store
          // mirror that a sync-applied or remote patch has not reached yet.
          const enabledToolIds = committedEnabledToolIds();
          const workspaceContent =
            applicationFacade().workspaceContent.snapshot();
          const admittedToolIds = enabledToolIds.filter(toolId =>
            isMemoryToolAllowed(toolId, {
              projectActive:
                !!identity.projectId &&
                workspaceContent.projects.some(
                  project => project.id === identity.projectId,
                ),
              allMemory: true,
            }),
          );
          if (!admittedToolIds.length) return {};
          const messages = workspaceContent.messages
            .filter(
              message => message.conversationId === identity.conversationId,
            )
            .map(workspaceMessage)
            .filter(message => !message.isSystemInfo);
          const tools = await mobileToolDefinitions(admittedToolIds, messages);
          return tools.length ? { tools, toolChoice: 'auto' } : {};
        },
      },
      operation,
      compactionRetry: {
        shouldRetry: ({ error }) => compaction.isCapacityError(error),
      },
      compaction: {
        compact: context =>
          compaction.compactChat(context, mobileCompactionOptions(context)),
      },
      events: { publish: publishSessionEvent },
    },
  ];
}
