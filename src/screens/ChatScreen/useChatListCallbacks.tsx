import React, { useCallback, useMemo, useRef } from 'react';
import type { Message } from '../../types';
import { MessageRenderer } from './MessageRenderer';
import type { useChatScreen } from './useChatScreen';

type Chat = ReturnType<typeof useChatScreen>;
export type ChatRowRenderer = (info: {
  item: any;
  index: number;
}) => React.JSX.Element;

/**
 * The FlatList row renderer, held stable.
 *
 * FlatList is a PureComponent, so a new `renderItem` function forces it to re-render every mounted
 * cell. It used to be an inline arrow rebuilt on every ChatScreen render, which is why an unrelated
 * render walked the whole transcript. Two things keep the identity still:
 *
 * - the row handlers, which useChatScreen rebuilds every render but which are behaviorally stable
 *   within a conversation (MessageRenderer's memo comparator already refuses to compare them), are
 *   reached through wrappers over a ref;
 * - everything left in the dependency list genuinely changes what a row draws, so a change there
 *   SHOULD reach the cells - and MessageRenderer's comparator then decides row by row.
 */
export function useChatRowRenderer(chat: Chat): ChatRowRenderer {
  const handlersRef = useRef({
    onCopy: chat.handleCopyMessage,
    onRetry: chat.handleRetryMessage,
    onEdit: chat.handleEditMessage,
    onGenerateImage: chat.handleGenerateImageFromMessage,
    onImagePress: chat.handleImagePress,
  });
  handlersRef.current = {
    onCopy: chat.handleCopyMessage,
    onRetry: chat.handleRetryMessage,
    onEdit: chat.handleEditMessage,
    onGenerateImage: chat.handleGenerateImageFromMessage,
    onImagePress: chat.handleImagePress,
  };
  const handlers = useMemo(
    () => ({
      onCopy: (content: string) => handlersRef.current.onCopy(content),
      onRetry: (message: Message) => handlersRef.current.onRetry(message),
      onEdit: (message: Message, newContent: string) =>
        handlersRef.current.onEdit(message, newContent),
      onGenerateImage: (prompt: string) =>
        handlersRef.current.onGenerateImage(prompt),
      onImagePress: (uri: string) => handlersRef.current.onImagePress(uri),
    }),
    [],
  );

  const displayMessagesLength = chat.displayMessages.length;
  const showGenerationDetails = chat.settings.showGenerationDetails === true;
  const { animateLastN, imageModelLoaded, isStreaming, isGeneratingImage } =
    chat;

  return useCallback(
    ({ item, index }) => (
      <MessageRenderer
        item={item}
        index={index}
        displayMessagesLength={displayMessagesLength}
        animateLastN={animateLastN}
        imageModelLoaded={imageModelLoaded}
        isStreaming={isStreaming}
        isGeneratingImage={isGeneratingImage}
        showGenerationDetails={showGenerationDetails}
        {...handlers}
      />
    ),
    [
      displayMessagesLength,
      animateLastN,
      imageModelLoaded,
      isStreaming,
      isGeneratingImage,
      showGenerationDetails,
      handlers,
    ],
  );
}

/**
 * Tracks whether the list is parked at the bottom, and tells the screen whether to offer the
 * scroll-to-bottom button. Stable, so passing it to FlatList costs no cell re-renders.
 */
export function useChatScrollTracker(
  isNearBottomRef: React.MutableRefObject<boolean>,
  setShowScrollToBottom: (show: boolean) => void,
): (event: any) => void {
  return useCallback(
    (event: any) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      const distanceFromBottom =
        contentSize.height - layoutMeasurement.height - contentOffset.y;
      isNearBottomRef.current = distanceFromBottom < 100;
      setShowScrollToBottom(!isNearBottomRef.current);
    },
    [isNearBottomRef, setShowScrollToBottom],
  );
}
