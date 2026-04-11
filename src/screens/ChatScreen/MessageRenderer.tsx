import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { ChatMessage } from '../../components';
import { AudioMessageBubble } from '../../components/AudioMessageBubble';
import { TTSButton } from '../../components/TTSButton';
import { AnimatedEntry } from '../../components/AnimatedEntry';
import { useTTSStore } from '../../stores/ttsStore';
import { stripControlTokens } from '../../utils/messageContent';
import { Message } from '../../types';
import '../../types/tts';
import { ChatMessageItem } from './useChatScreen';
import { parseThinkingContent, buildMessageData } from '../../components/ChatMessage/utils';
import { ThinkingBlock } from '../../components/ChatMessage/components/ThinkingBlock';
import { createStyles as createChatStyles } from '../../components/ChatMessage/styles';
import { useThemedStyles } from '../../theme';

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

/** Renders the thinking/reasoning block for audio mode without the ChatMessage bubble wrapper */
const AudioModeThinkingBlock: React.FC<{ msg: Message }> = ({ msg }) => {
  const chatStyles = useThemedStyles(createChatStyles);
  const [showThinking, setShowThinking] = useState(false);
  const { parsedContent } = buildMessageData(msg);
  if (!parsedContent.thinking) return null;
  return (
    <View style={chatStyles.thinkingBlockWrapper}>
      <ThinkingBlock
        parsedContent={parsedContent}
        showThinking={showThinking}
        onToggle={() => setShowThinking((v) => !v)}
        styles={chatStyles}
      />
    </View>
  );
};

interface AudioBubbleProps {
  messageId: string;
  audioPath: string;
  waveformData: number[];
  durationSeconds: number;
  transcript: string;
  _reasoningContent?: string;
}

function buildAudioBubbleProps(msg: Message): AudioBubbleProps {
  const transcript = stripControlTokens(msg.content);
  console.log('[AudioBubble] buildProps: msgId=', msg.id, 'contentLen=', msg.content.length, 'transcriptLen=', transcript.length);
  return {
    messageId: msg.id,
    audioPath: msg.audioPath ?? '',
    waveformData: msg.waveformData ?? [],
    durationSeconds: msg.audioDurationSeconds ?? 0,
    transcript,
    _reasoningContent: msg.reasoningContent,
  };
}

/** Wraps content with AnimatedEntry if needed */
function wrapAnimated(content: React.ReactElement, shouldAnimate: boolean): React.ReactElement {
  return shouldAnimate ? <AnimatedEntry index={0}>{content}</AnimatedEntry> : content;
}

/** Renders a user voice message as an audio bubble */
function renderUserAudioBubble(
  opts: { msg: Message; audioAtt: any; shouldAnimate: boolean },
  props: MessageRendererProps,
): React.ReactElement {
  const { msg, audioAtt, shouldAnimate } = opts;
  const bubble = (
    <View style={audioStyles.userContainer}>
      <AudioMessageBubble
        messageId={msg.id}
        audioPath={audioAtt.uri}
        waveformData={[]}
        durationSeconds={audioAtt.audioDurationSeconds ?? 0}
        transcript={msg.content}
        isUser
        onCopy={props.onCopy}
        onRetry={() => props.onRetry(msg)}
      />
    </View>
  );
  return wrapAnimated(bubble, shouldAnimate);
}

/** Renders a streaming/thinking assistant message in audio mode as a ChatMessage */
function renderAudioStreamingMessage(
  msg: Message,
  isStreamingThis: boolean,
  props: MessageRendererProps,
): React.ReactElement {
  return (
    <ChatMessage
      message={msg}
      isStreaming={isStreamingThis}
      onCopy={props.onCopy}
      onRetry={props.onRetry}
      onEdit={props.onEdit}
      onGenerateImage={props.onGenerateImage}
      onImagePress={props.onImagePress}
      canGenerateImage={false}
      showGenerationDetails={props.showGenerationDetails}
      animateEntry={false}
    />
  );
}

/** Renders a completed assistant audio bubble, with optional tool call UI */
function renderAudioAssistantBubble(
  msg: Message,
  shouldAnimate: boolean,
  props: MessageRendererProps,
): React.ReactElement {
  const hasThinking = !!msg.reasoningContent || !!parseThinkingContent(msg.content).thinking;
  const hasToolCalls = !!msg.toolCalls?.length;

  // For messages with tool calls, render as a regular ChatMessage (has proper tool call UI)
  // followed by the audio bubble for the spoken text
  if (hasToolCalls) {
    const element = (
      <View style={audioStyles.assistantContainer}>
        <ChatMessage
          message={msg}
          isStreaming={false}
          onCopy={props.onCopy}
          onRetry={props.onRetry}
          onEdit={props.onEdit}
          onGenerateImage={props.onGenerateImage}
          onImagePress={props.onImagePress}
          canGenerateImage={false}
          showGenerationDetails={props.showGenerationDetails}
          animateEntry={false}
        />
      </View>
    );
    return wrapAnimated(element, shouldAnimate);
  }

  const bubble = (
    <View style={audioStyles.assistantContainer}>
      {hasThinking && <AudioModeThinkingBlock msg={msg} />}
      <AudioMessageBubble
        {...buildAudioBubbleProps(msg)}
        onCopy={props.onCopy}
        onRetry={() => props.onRetry(msg)}
      />
    </View>
  );
  return wrapAnimated(bubble, shouldAnimate);
}

export const MessageRenderer: React.FC<MessageRendererProps> = (props) => {
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

  const ttsMode = useTTSStore((s) => s.settings.interfaceMode);
  const msg = item as Message;
  const animateEntry = animateLastN > 0 && index >= displayMessagesLength - animateLastN;
  const isStreamingThis = item.id === 'streaming';

  // User voice message: always show as audio bubble
  if (msg.role === 'user') {
    const audioAtt = msg.attachments?.find((a) => a.type === 'audio');
    if (audioAtt) {
      return renderUserAudioBubble({ msg, audioAtt, shouldAnimate: animateEntry }, props);
    }
  }

  const isAudioAssistant = msg.role === 'assistant' && !msg.isSystemInfo;

  // Thinking placeholder + audio streaming
  const isThinkingItem = !!(msg as any).isThinking;
  if (isAudioAssistant && ttsMode === 'audio' && (isStreamingThis || isThinkingItem)) {
    return renderAudioStreamingMessage(msg, isStreamingThis, props);
  }

  // Audio Mode: show assistant messages as audio bubbles after streaming ends
  if (isAudioAssistant && ttsMode === 'audio' && !isStreamingThis) {
    return renderAudioAssistantBubble(msg, animateEntry, props);
  }

  // Chat Mode: TTSButton lives in the meta row
  const isPlainAssistant = msg.role === 'assistant' && !msg.isSystemInfo && !msg.toolCalls?.length;
  const ttsMeta = isPlainAssistant && !isStreamingThis
    ? <TTSButton text={stripControlTokens(msg.content)} messageId={msg.id} />
    : undefined;

  return (
    <ChatMessage
      message={msg}
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
};

const audioStyles = StyleSheet.create({
  userContainer: {
    paddingRight: 16,
    marginVertical: 8,
    alignItems: 'flex-end',
  },
  assistantContainer: {
    paddingHorizontal: 16,
    marginVertical: 8,
    alignItems: 'flex-start',
  },
});
