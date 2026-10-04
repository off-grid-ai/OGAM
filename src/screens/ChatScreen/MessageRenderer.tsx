import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ChatMessage } from '../../components';
import { ThinkingIndicator } from '../../components/ThinkingIndicator';
import { SPACING } from '../../constants';
import { prepareMessageForSpeech } from '../../utils/messageContent';
import { Message } from '../../types';
import { useSpeechProjection } from '../../hooks/useApplicationProjection';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { ChatMessageItem } from './useChatScreen';
import { STREAMING_MESSAGE_ID } from './types';
import { useActiveStreamText } from './useActiveStreamText';

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
    onGenerateImage,
    onImagePress,
  } = props;

  const voiceMode = useSpeechProjection().preferences.voiceMode;
  const msg = item as Message;
  const animateEntry =
    animateLastN > 0 && index >= displayMessagesLength - animateLastN;
  const isStreamingThis = item.id === 'streaming' || item.isStreaming === true;
  const statusText = (item as ChatMessageItem).statusText;
  const suppressMessageBubble = (item as ChatMessageItem).suppressMessageBubble;
  const supportingContext = (item as ChatMessageItem).supportingContext;

  // Audio mode: the pro audio feature owns the whole message presentation
  // (user/assistant bubbles, thinking, streaming). Free builds never reach
  // this branch because the audio slot is absent.
  const AudioMessage = getSlot(SLOTS.messageAudioMode);
  if (voiceMode && AudioMessage) {
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
    marginTop: SPACING.xs,
  },
});

/**
 * Memoized so a ChatScreen re-render (a focus after returning from the document picker, a keyboard
 * event, any unrelated store tick) does NOT re-render and re-parse the markdown of every message —
 * the cause of the chat-screen freeze (unresponsive until you leave + re-enter). getDisplayMessages
 * returns [...allMessages, syntheticItem], so the historical message objects keep stable refs
 * across renders and every committed row skips.
 *
 * A token no longer produces a new item at all: the 'streaming' row is token-free and stable for
 * the turn, and its text is read inside LiveStreamMessageRenderer below.
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

const CommittedMessageRenderer = React.memo(
  MessageRendererInner,
  messageRendererPropsEqual,
);

/**
 * The in-progress reply - the ONLY component in the chat that re-renders per token.
 *
 * The screen model hands down a token-free 'streaming' row (stable object identity for the whole
 * turn), and the live text is read here from its own narrow projection. So a flush re-renders this
 * one leaf; the committed rows above it are not even compared.
 */
const LiveStreamMessageRenderer: React.FC<MessageRendererProps> = props => {
  const live = useActiveStreamText();
  const item = React.useMemo(
    () => ({
      ...props.item,
      content: live.content,
      reasoningContent: live.reasoningContent,
    }),
    [props.item, live],
  );
  return <CommittedMessageRenderer {...props} item={item} />;
};

const MessageRendererDispatch: React.FC<MessageRendererProps> = props =>
  props.item.id === STREAMING_MESSAGE_ID ? (
    <LiveStreamMessageRenderer {...props} />
  ) : (
    <CommittedMessageRenderer {...props} />
  );

export const MessageRenderer = React.memo(
  MessageRendererDispatch,
  messageRendererPropsEqual,
);
