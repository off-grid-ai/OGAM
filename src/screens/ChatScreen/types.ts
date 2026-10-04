import {
  chatStreamPhaseIsStatus,
  chatStreamPhaseLabel,
  chatStreamPreviewHasMessageBody,
  isSupportingChatContext,
  splitInlineReasoning,
  type ChatStreamPreviewRow,
  type MessageRecord,
} from '@offgrid/application';
import { Message } from '../../types';
import { visibleMessages } from '../../utils/visibleMessages';
import {projectWorkspaceMessage} from '../../services/adapters/workspaceContent/projectWorkspaceMessage';

/**
 * One durable message, read only from the canonical Workspace Content record - never from a
 * legacy Zustand mirror. A Shared-created conversation (Sync materialization, another Shared-owned
 * surface) has no such mirror, so this is the only path that can ever render its transcript.
 */
export function toWorkspaceMessage(record: MessageRecord): Message {
  return projectWorkspaceMessage(record);
}
export type ChatMessageItem = Message & {
  statusText?: string;
  suppressMessageBubble?: boolean;
  /** Display-only context rendered inside the following generated-image bubble. */
  supportingContext?: Message;
};

const groupedImageCache = new WeakMap<
  Message,
  { supportingContext: Message; item: ChatMessageItem }
>();

function isSupportingContextMessage(message: Message): boolean {
  if (message.role !== 'assistant' || message.attachments?.length) return false;
  const inline = splitInlineReasoning(message.content);
  return isSupportingChatContext({
    answer: inline.answer,
    reasoning: message.reasoningContent || inline.reasoning,
    reasoningLabel: inline.reasoningLabel,
  });
}

function hasImageAttachment(message: Message): boolean {
  return (
    message.role === 'assistant' &&
    Boolean(
      message.attachments?.some(attachment => attachment.type === 'image'),
    )
  );
}

/** Prefer canonical tool-result rows when they exist; recovered artifacts fill only missing rows. */
function withoutDuplicateToolArtifacts(messages: readonly Message[]): Message[] {
  const completedCallIds = new Set(
    messages
      .filter(message => message.role === 'tool' && message.toolCallId)
      .map(message => message.toolCallId as string),
  );
  if (completedCallIds.size === 0) return [...messages];
  return messages.map(message => {
    if (!message.toolArtifacts?.length) return message;
    const toolArtifacts = message.toolArtifacts.filter(
      artifact => !artifact.id || !completedCallIds.has(artifact.id),
    );
    return toolArtifacts.length === message.toolArtifacts.length
      ? message
      : {...message, toolArtifacts};
  });
}

function isGeneratedImageResult(message: Message): boolean {
  return (
    message.role === 'assistant' &&
    /^Generated image for:/i.test(message.content.trim())
  );
}

function withPendingGeneratedImage(message: Message): Message {
  if (hasImageAttachment(message)) return message;
  return {
    ...message,
    attachments: [
      {
        id: `pending-image:${message.uuid ?? message.id}`,
        type: 'image',
        uri: '',
        pending: true,
        fileName: 'Image arriving',
      },
    ],
  };
}

/**
 * Keep durable chat records unchanged, but present an image turn as one assistant result.
 *
 * Image generation writes the enhanced prompt first and the image result second. When those records
 * are adjacent, the final image owns the prompt, image, caption, metadata, and actions on screen.
 * An unfinished or cancelled prompt stays visible as its own supporting-context row.
 */
function groupSupportingContextWithImage(
  messages: readonly (Message | ChatMessageItem)[],
): (Message | ChatMessageItem)[] {
  const grouped: (Message | ChatMessageItem)[] = [];
  for (const message of messages) {
    const supportingContext = grouped.at(-1);
    if (
      (hasImageAttachment(message) || isGeneratedImageResult(message)) &&
      supportingContext &&
      isSupportingContextMessage(supportingContext)
    ) {
      grouped.pop();
      const cached = groupedImageCache.get(message);
      if (cached?.supportingContext === supportingContext) {
        grouped.push(cached.item);
        continue;
      }
      const item: ChatMessageItem = {
        ...withPendingGeneratedImage(message),
        supportingContext,
      };
      groupedImageCache.set(message, { supportingContext, item });
      grouped.push(item);
      continue;
    }
    grouped.push(message);
  }
  return grouped;
}

/**
 * A reply generating on another device, mirrored into this conversation while it happens.
 *
 * Shaped by shared sync (`chatStreamPreviewRows`) rather than here, so the phone and the Mac append
 * the same rows in the same order under the same ids.
 */
export type RemoteStreamItem = ChatStreamPreviewRow;

/** The synthetic row that stands for the reply being generated on THIS device. */
export const STREAMING_MESSAGE_ID = 'streaming';

export type StreamingState = {
  isThinking: boolean;
  streamingMessage: string;
  streamingReasoningContent: string;
  /**
   * The live reply has produced text, even though `streamingMessage` above is empty.
   *
   * The screen model passes this instead of the text so a token never reaches it: the row it asks
   * for is drawn by one leaf that reads the text itself (`useActiveStreamText`). A caller that
   * already holds the text (a test, a projection over a finished turn) can keep passing it and this
   * stays undefined.
   */
  hasStreamingText?: boolean;
  isStreamingForThisConversation: boolean;
  isModelLoading?: boolean;
  loadingModelName?: string;
  isGeneratingForThisConversation?: boolean;
  /** Live previews from paired devices. Empty in free builds and when nothing is generating. */
  remotePreviews?: readonly RemoteStreamItem[];
  /** This device's mesh id, so a peer's runtime notices can be told apart from its own. */
  localDeviceId?: string | null;
};

/**
 * Append the replies other devices are generating right now.
 *
 * They render through the SAME synthetic-streaming-message path as the local reply, so there is one
 * bubble implementation rather than a second renderer that would drift from it. Ids are namespaced
 * per generation so the list keeps one row per in-flight reply and never collides with the local
 * 'streaming' row - a device can be generating locally while a peer generates too.
 */
function withRemotePreviews(
  base: (Message | ChatMessageItem)[],
  remotePreviews: readonly RemoteStreamItem[] | undefined,
): (Message | ChatMessageItem)[] {
  if (!remotePreviews || remotePreviews.length === 0) return base;
  const durableMessageIds = new Set<string>();
  for (const message of base) {
    durableMessageIds.add(message.id);
    if (message.uuid) durableMessageIds.add(message.uuid);
  }
  return [
    ...base,
    ...remotePreviews
      .filter(
        preview =>
          !durableMessageIds.has(preview.messageId) &&
          !base.some(message => sameRemoteAnswer(message, preview)),
      )
      .map(remotePreviewMessage),
  ];
}

function sameRemoteAnswer(
  message: Message | ChatMessageItem,
  preview: RemoteStreamItem,
): boolean {
  if (
    message.role !== 'assistant' ||
    message.provenance?.originDeviceId !== preview.deviceId ||
    !chatStreamPreviewHasMessageBody(preview)
  ) {
    return false;
  }
  return (
    message.content.trim() === preview.content.trim() &&
    (message.reasoningContent ?? '').trim() === (preview.reasoning ?? '').trim()
  );
}

function remotePreviewMessage(preview: RemoteStreamItem): ChatMessageItem {
  const phaseLabel = chatStreamPhaseLabel(preview.phase, preview.progress);
  const hasMessageBody = chatStreamPreviewHasMessageBody(preview);
  // One rule, asked three times, instead of three hand-kept lists of phase names. A status phase
  // renders BESIDE whatever arrived, so it only becomes the whole row when nothing else has.
  const isStatusPhase = chatStreamPhaseIsStatus(preview.phase);
  const previewOwnedTools = preview.tools ?? [];
  const isStatusOnly =
    preview.phase === 'waiting' ||
    (isStatusPhase && !hasMessageBody && !preview.reasoning) ||
    (preview.phase === 'thinking' && !preview.reasoning && !preview.content);
  return {
    // The id comes from the shared projection, so it is stable across frames.
    id: preview.id,
    role: 'assistant',
    content: isStatusOnly ? phaseLabel ?? '' : preview.content,
    reasoningContent: preview.reasoning || undefined,
    timestamp: Date.now(),
    isThinking: isStatusOnly,
    isStreaming: true,
    suppressMessageBubble: isStatusPhase && !hasMessageBody,
    // The preview owns every tool while the turn is live. Its stable message id lets the durable
    // assistant record replace the whole preview atomically when it arrives, so calls appear as
    // they start without leaving a duplicate after final message sync.
    ...(previewOwnedTools.length
      ? {
          toolArtifacts: previewOwnedTools.map(tool => ({
            name: tool.name,
            result: tool.result ?? '',
            status: tool.status,
          })),
        }
      : {}),
    ...(isStatusPhase && phaseLabel ? { statusText: phaseLabel } : {}),
  };
}

let _lastDisplayBranch = '';
export function getDisplayMessages(
  allMessages: Message[],
  streaming: StreamingState,
): (Message | ChatMessageItem)[] {
  return withRemotePreviews(
    groupSupportingContextWithImage(
      localDisplayMessages(
        // The same rule the list rows use, so the thread and its preview never disagree.
        withoutDuplicateToolArtifacts([
          ...visibleMessages(allMessages, streaming.localDeviceId),
        ]),
        streaming,
      ),
    ),
    streaming.remotePreviews,
  );
}

function localDisplayMessages(
  allMessages: Message[],
  streaming: StreamingState,
): (Message | ChatMessageItem)[] {
  const {
    isThinking,
    streamingMessage,
    streamingReasoningContent,
    isStreamingForThisConversation,
  } = streaming;
  // Model still loading for the in-progress reply: show it in the bubble so the
  // wait is explained ("Loading <model>…") instead of bare dots.
  if (
    streaming.isModelLoading &&
    streaming.isGeneratingForThisConversation &&
    !streamingMessage
  ) {
    return [
      ...allMessages,
      {
        id: 'thinking',
        role: 'assistant' as const,
        content: streaming.loadingModelName
          ? `Loading ${streaming.loadingModelName}...`
          : 'Loading model...',
        timestamp: Date.now(),
        isThinking: true,
      },
    ];
  }
  if (isThinking && isStreamingForThisConversation) {
    if (_lastDisplayBranch !== 'thinking') {
      _lastDisplayBranch = 'thinking';
    }
    return [
      ...allMessages,
      {
        id: 'thinking',
        role: 'assistant' as const,
        content: '',
        timestamp: Date.now(),
        isThinking: true,
      },
    ];
  }
  if (
    (streamingMessage || streamingReasoningContent || streaming.hasStreamingText) &&
    isStreamingForThisConversation
  ) {
    if (_lastDisplayBranch !== 'streaming') {
      _lastDisplayBranch = 'streaming';
    }
    return [
      ...allMessages,
      {
        id: STREAMING_MESSAGE_ID,
        role: 'assistant' as const,
        content: streamingMessage,
        reasoningContent: streamingReasoningContent || undefined,
        timestamp: Date.now(),
        isStreaming: true,
      },
    ];
  }
  if (_lastDisplayBranch !== 'done') {
    _lastDisplayBranch = 'done';
  }
  return allMessages;
}

type PlaceholderTextOptions = {
  hasModel: boolean;
  isModelLoading: boolean;
  supportsVision: boolean;
  imageOnly?: boolean;
};

export function getPlaceholderText({
  hasModel,
  isModelLoading,
  supportsVision,
  imageOnly,
}: PlaceholderTextOptions): string {
  if (!hasModel)
    return isModelLoading ? 'Loading model...' : 'Load a model to use chat';
  if (imageOnly) return 'Describe an image...';
  return supportsVision
    ? 'Type a message or add an image...'
    : 'Type a message...';
}
