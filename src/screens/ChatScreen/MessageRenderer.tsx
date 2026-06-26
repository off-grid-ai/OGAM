import React from 'react';
import { ChatMessage } from '../../components';
import { stripControlTokens } from '../../utils/messageContent';
import { Message } from '../../types';
import { useUiModeStore } from '../../stores';
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
  onGenerateImage: (prompt: string) => void;
  onImagePress: (uri: string) => void;
};

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

  const interfaceMode = useUiModeStore((s) => s.interfaceMode);
  const msg = item as Message;
  const animateEntry = animateLastN > 0 && index >= displayMessagesLength - animateLastN;
  const isStreamingThis = item.id === 'streaming';

  // Audio mode: the pro audio feature owns the whole message presentation
  // (user/assistant bubbles, thinking, streaming). Free builds never reach
  // this branch (interfaceMode stays 'chat').
  const AudioMessage = getSlot(SLOTS.messageAudioMode);
  if (interfaceMode === 'audio' && AudioMessage) {
    return (
      <AudioMessage
        msg={msg}
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
  }

  // Chat Mode: the speak button (pro slot) lives in the meta row.
  const Speak = getSlot(SLOTS.messageSpeakButton);
  const isPlainAssistant = msg.role === 'assistant' && !msg.isSystemInfo && !msg.toolCalls?.length;
  // No speaker on an in-progress reply (streaming, or the thinking/loading dots).
  const ttsMeta =
    isPlainAssistant && !isStreamingThis && !(msg as Message).isThinking && Speak
      ? <Speak text={stripControlTokens(msg.content)} messageId={msg.id} />
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
