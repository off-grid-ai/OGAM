import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ChatMessage } from '../../components';
import { ThinkingIndicator } from '../../components/ThinkingIndicator';
import { SPACING } from '../../constants';
import { prepareMessageForSpeech } from '../../utils/messageContent';
import { Message } from '../../types';
import { useChatStore, useUiModeStore } from '../../stores';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { ChatMessageItem } from './useChatScreen';

type MessageRendererProps = {
  item: Message | ChatMessageItem;
  index: number;
  displayMessagesLength: number;
  animateLastN: number;
  imageModelLoaded: boolean;
  isStreaming: boolean;
  isGeneratingImage: boolean;
  showGenerationDetails: boolean;
  onCopy: (content: string) => void;
  onRetry: (message: Message) => void;
  onEdit: (message: Message, newContent: string) => void;
  onTranscribeAgain?: (
    message: Message,
    attachment: NonNullable<Message['attachments']>[number],
  ) => Promise<void>;
  onGenerateImage: (prompt: string) => void;
  onImagePress: (uri: string) => void;
};

const MessageRendererInner: React.FC<MessageRendererProps> = props => {
  const {
    item,
    index,
    displayMessagesLength,
    animateLastN,
    imageModelLoaded,
    isStreaming,
    isGeneratingImage,
    showGenerationDetails,
    onCopy,
    onRetry,
    onEdit,
    onTranscribeAgain,
    onGenerateImage,
    onImagePress,
  } = props;

  const interfaceMode = useUiModeStore(s => s.interfaceMode);
  const msg = item as Message;
  const animateEntry =
    animateLastN > 0 && index >= displayMessagesLength - animateLastN;
  const isStreamingThis =
    item.id === 'streaming' ||
    item.isStreaming === true ||
    (isGeneratingImage &&
      item.role === 'assistant' &&
      index === displayMessagesLength - 1);
  const statusText = (item as ChatMessageItem).statusText;
  const suppressMessageBubble = (item as ChatMessageItem).suppressMessageBubble;
  const supportingContext = (item as ChatMessageItem).supportingContext;

  // Audio mode: the pro audio feature owns the whole message presentation
  // (user/assistant bubbles, thinking, streaming). Free builds never reach
  // this branch (interfaceMode stays 'chat').
  const AudioMessage = getSlot(SLOTS.messageAudioMode);
  if (interfaceMode === 'audio' && AudioMessage) {
    const audioMessage = (
      <AudioMessage
        msg={msg}
        supportingContext={supportingContext}
        isStreamingThis={isStreamingThis}
        shouldAnimate={animateEntry}
        showGenerationDetails={showGenerationDetails}
        onCopy={onCopy}
        onRetry={onRetry}
        onEdit={onEdit}
        onTranscribeAgain={onTranscribeAgain}
        onGenerateImage={onGenerateImage}
        onImagePress={onImagePress}
      />
    );
    return statusText ? (
      <View>
        {!suppressMessageBubble && audioMessage}
        <View style={styles.remoteStatus}>
          <ThinkingIndicator text={statusText} />
        </View>
      </View>
    ) : (
      audioMessage
    );
  }

  // Chat Mode: the speak button (pro slot) lives in the meta row.
  const Speak = getSlot(SLOTS.messageSpeakButton);
  const isPlainAssistant =
    msg.role === 'assistant' && !msg.isSystemInfo && !msg.toolCalls?.length;
  // No speaker on an in-progress reply (streaming, or the thinking/loading dots).
  const ttsMeta =
    isPlainAssistant &&
    !isStreamingThis &&
    !(msg as Message).isThinking &&
    Speak ? (
      <Speak text={prepareMessageForSpeech(msg.content)} messageId={msg.id} />
    ) : undefined;

  const message = (
    <ChatMessage
      message={msg}
      supportingContext={supportingContext}
      isStreaming={isStreamingThis}
      onCopy={onCopy}
      onRetry={onRetry}
      onEdit={onEdit}
      onTranscribeAgain={onTranscribeAgain}
      onGenerateImage={onGenerateImage}
      onImagePress={onImagePress}
      canGenerateImage={imageModelLoaded && !isStreaming && !isGeneratingImage}
      showGenerationDetails={showGenerationDetails}
      animateEntry={animateEntry}
      metaExtra={ttsMeta}
    />
  );
  return statusText ? (
    <View>
      {!suppressMessageBubble && message}
      <View style={styles.remoteStatus}>
        <ThinkingIndicator text={statusText} />
      </View>
    </View>
  ) : (
    message
  );
};

const styles = StyleSheet.create({
  remoteStatus: {
    marginLeft: SPACING.xl,
    marginTop: SPACING.md,
  },
});

/**
 * Memoized so a ChatScreen re-render (a streaming token, a focus after returning from
 * the document picker, a keyboard event, any unrelated store tick) does NOT re-render
 * and re-parse the markdown of every message — the cause of the chat-screen freeze
 * (unresponsive until you leave + re-enter). getDisplayMessages returns
 * [...allMessages, streamingItem], so the historical message objects keep stable refs
 * across renders; only the 'streaming'/'thinking' item is a new object per token, so
 * only IT re-renders while the rest skip.
 *
 * The on* callbacks are recreated every parent render (defined inline in useChatScreen)
 * and are deliberately NOT compared: within a conversation they are behaviorally stable,
 * and a conversation switch replaces every message object (item ref changes → re-render
 * with fresh handlers). Comparing them would defeat the memo entirely.
 */
export function messageRendererPropsEqual(
  prev: MessageRendererProps,
  next: MessageRendererProps,
): boolean {
  return (
    prev.item === next.item &&
    prev.index === next.index &&
    prev.displayMessagesLength === next.displayMessagesLength &&
    prev.animateLastN === next.animateLastN &&
    prev.imageModelLoaded === next.imageModelLoaded &&
    prev.isStreaming === next.isStreaming &&
    prev.isGeneratingImage === next.isGeneratingImage &&
    prev.showGenerationDetails === next.showGenerationDetails
  );
}

const StableMessageRenderer = React.memo(
  MessageRendererInner,
  messageRendererPropsEqual,
);

const LiveStreamMessageRenderer: React.FC<MessageRendererProps> = props => {
  const content = useChatStore(state => state.streamingMessage);
  const reasoningContent = useChatStore(state => state.streamingReasoningContent);
  const item = React.useMemo(() => ({
    ...props.item,
    content,
    reasoningContent: reasoningContent || undefined,
  }), [props.item, content, reasoningContent]);
  return <StableMessageRenderer {...props} item={item} />;
};

const MessageRendererDispatch: React.FC<MessageRendererProps> = props =>
  props.item.id === 'streaming' ? (
    <LiveStreamMessageRenderer {...props} />
  ) : (
    <StableMessageRenderer {...props} />
  );

export const MessageRenderer = React.memo(
  MessageRendererDispatch,
  messageRendererPropsEqual,
);
