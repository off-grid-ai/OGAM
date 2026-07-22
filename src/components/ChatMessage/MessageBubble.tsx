import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type { useTheme } from '../../theme';
import type { Message } from '../../types';
import { GenerationMeta } from './components/GenerationMeta';
import { MessageAttachments } from './components/MessageAttachments';
import { MessageContent } from './components/MessageContent';
import { ToolsSentCollapsible } from './components/ToolsSentCollapsible';
import { createStyles } from './styles';
import { buildMessageData, formatDuration, formatTime } from './utils';

const RoutedToolsRow: React.FC<{
  message: Message;
  isUser: boolean;
  isStreaming?: boolean;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
}> = ({ message, isUser, isStreaming, styles, colors }) => {
  const names = message.generationMeta?.routedToolNames;
  if (isUser || isStreaming || !names?.length) return null;
  return (
    <ToolsSentCollapsible
      names={names}
      stableKey={message.id}
      styles={styles}
      colors={colors}
    />
  );
};

const MessageMetaRow: React.FC<{
  message: Message;
  styles: ReturnType<typeof createStyles>;
  isStreaming?: boolean;
  showActions: boolean;
  onMenuOpen: () => void;
  metaExtra?: React.ReactNode;
}> = ({ message, styles, isStreaming, showActions, onMenuOpen, metaExtra }) => (
  <View style={styles.metaRow}>
    <Text style={styles.timestamp}>{formatTime(message.timestamp)}</Text>
    {message.generationTimeMs != null && message.role === 'assistant' && (
      <Text style={styles.generationTime}>
        {formatDuration(message.generationTimeMs)}
      </Text>
    )}
    {metaExtra}
    {showActions && !isStreaming && (
      <TouchableOpacity style={styles.actionHint} onPress={onMenuOpen}>
        <Text style={styles.actionHintText}>•••</Text>
      </TouchableOpacity>
    )}
  </View>
);

interface MessageBubbleProps {
  message: Message;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
  isUser: boolean;
  isStreaming?: boolean;
  hasAttachments: boolean;
  bubbleStyle: StyleProp<ViewStyle>;
  parsedContent: ReturnType<typeof buildMessageData>['parsedContent'];
  showThinking: boolean;
  showActions: boolean;
  showGenerationDetails: boolean;
  metaExtra?: React.ReactNode;
  onImagePress?: (uri: string) => void;
  onToggleThinking: () => void;
  onLongPress: () => void;
  onMenuOpen: () => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  styles,
  colors,
  isUser,
  isStreaming,
  hasAttachments,
  bubbleStyle,
  parsedContent,
  showThinking,
  showActions,
  showGenerationDetails,
  metaExtra,
  onImagePress,
  onToggleThinking,
  onLongPress,
  onMenuOpen,
}) => (
  <TouchableOpacity
    testID={isUser ? 'user-message' : 'assistant-message'}
    style={[
      styles.container,
      isUser ? styles.userContainer : styles.assistantContainer,
    ]}
    activeOpacity={0.8}
    onLongPress={onLongPress}
    delayLongPress={300}
  >
    <View style={bubbleStyle}>
      {hasAttachments && (
        <MessageAttachments
          attachments={message.attachments!}
          isUser={isUser}
          styles={styles}
          colors={colors}
          onImagePress={onImagePress}
        />
      )}
      <MessageContent
        isUser={isUser}
        isThinking={message.isThinking}
        content={message.content}
        isStreaming={isStreaming}
        parsedContent={parsedContent}
        showThinking={showThinking}
        onToggleThinking={onToggleThinking}
        styles={styles}
      />
    </View>
    <RoutedToolsRow
      message={message}
      isUser={isUser}
      isStreaming={isStreaming}
      styles={styles}
      colors={colors}
    />
    {!isUser && !isStreaming && message.generationMeta?.truncated && (
      <View testID="message-cutoff-indicator" style={styles.toolStatusRow}>
        <Icon name="alert-triangle" size={12} color={colors.textMuted} />
        <Text style={styles.toolStatusText}>
          Reply cut off at the token limit. Retry to continue.
        </Text>
      </View>
    )}
    <MessageMetaRow
      message={message}
      styles={styles}
      isStreaming={isStreaming}
      showActions={showActions}
      onMenuOpen={onMenuOpen}
      metaExtra={metaExtra}
    />
    {showGenerationDetails && !isUser && message.generationMeta && (
      <GenerationMeta generationMeta={message.generationMeta} styles={styles} />
    )}
  </TouchableOpacity>
);
