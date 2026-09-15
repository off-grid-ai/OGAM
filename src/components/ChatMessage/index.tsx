import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Clipboard } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme, useThemedStyles } from '../../theme';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import Icon from 'react-native-vector-icons/Feather';
import {
  showAlert,
  hideAlert,
  AlertState,
  initialAlertState,
} from '../CustomAlert';
import { AnimatedEntry } from '../AnimatedEntry';
import { Accordion } from '../Accordion';
import { triggerHaptic } from '../../utils/haptics';
import { createStyles } from './styles';
import { MessageAttachments } from './components/MessageAttachments';
import { MessageContent } from './components/MessageContent';
import { GenerationMeta } from './components/GenerationMeta';
import { MessageOverlays } from './components/MessageOverlays';
import { MarkdownText } from '../MarkdownText';
import { formatTime, formatDuration, buildMessageData } from './utils';
import { ThinkingBlock } from './components/ThinkingBlock';
import {
  ToolResultMessage,
  ToolCallMessage,
  SystemInfoMessage,
  RoutedToolsRow,
  SyncedToolArtifacts,
} from './components/ToolMessages';
import type { ChatMessageProps } from './types';
import type { Message } from '../../types';
import { isSupportingChatContext } from '@offgrid/sync';

type MetaRowProps = {
  message: Message;
  styles: ReturnType<typeof createStyles>;
  isStreaming?: boolean;
  showActions: boolean;
  onMenuOpen: () => void;
  metaExtra?: React.ReactNode;
};

const MessageMetaRow: React.FC<MetaRowProps> = ({
  message,
  styles,
  isStreaming,
  showActions,
  onMenuOpen,
  metaExtra,
}) => (
  <View testID="message-meta-row" style={styles.metaRow}>
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

const ToolCallWithThinking: React.FC<{
  message: Message;
  showThinking: boolean;
  onToggle: () => void;
  styles: any;
  colors: any;
  hideProse?: boolean;
}> = ({ message, showThinking, onToggle, styles, colors, hideProse }) => {
  // Use buildMessageData (the single source that honors message.reasoningContent from the
  // separate reasoning channel AND inline <think> in content) so a tool-call message keeps
  // its pre-tool-call thinking block. Reading only parseThinkingContent(content) missed the
  // reasoningContent case → the first round of thinking vanished when the tool fired (OD14).
  const tc =
    message.content || message.reasoningContent
      ? buildMessageData(message).parsedContent
      : null;
  const hasText = !hideProse && !!tc?.response?.trim();
  // Left-aligned + bubble-width, matching a NORMAL assistant reply — a tool-call reply is an
  // assistant message, so its thinking box + pre-text + tool cards must line up with every other
  // AI message. (Previously used systemInfoContainer — centered, full-bleed — so the pre-tool-call
  // thinking box lost its left alignment and ran full width in both text and voice mode.)
  return (
    <View style={[styles.container, styles.assistantContainer]}>
      <View style={styles.toolCallReplyContent}>
        {!!tc?.thinking && (
          <View style={styles.thinkingBlockWrapper}>
            <ThinkingBlock
              parsedContent={tc}
              showThinking={showThinking}
              onToggle={onToggle}
              styles={styles}
            />
          </View>
        )}
        {hasText && (
          <View testID="tool-call-pre-text" style={styles.toolCallPreText}>
            <MarkdownText>{tc!.response}</MarkdownText>
          </View>
        )}
        <ToolCallMessage message={message} styles={styles} colors={colors} />
      </View>
    </View>
  );
};

const TimelineThinkingBlock: React.FC<{
  text: string;
  styles: ReturnType<typeof createStyles>;
}> = ({ text, styles }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <ThinkingBlock
      parsedContent={{
        thinking: text,
        response: '',
        isThinkingComplete: true,
      }}
      showThinking={expanded}
      onToggle={() => setExpanded(value => !value)}
      styles={styles}
    />
  );
};

const SyncedAssistantTimeline: React.FC<{
  message: Message;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
}> = ({ message, styles, colors }) => (
  <>
    {message.timeline?.map((entry, index) => {
      if (entry.kind === 'thinking') {
        return (
          <TimelineThinkingBlock
            key={`thinking:${index}`}
            text={entry.text}
            styles={styles}
          />
        );
      }
      return message.toolArtifacts?.[entry.toolIndex] ? (
        <SyncedToolArtifacts
          key={`tool:${entry.toolIndex}`}
          message={message}
          indexes={[entry.toolIndex]}
          styles={styles}
          colors={colors}
        />
      ) : null;
    })}
  </>
);

// The rendered message bubble (attachments + content + tool row + meta). Split out of
// ChatMessage so its per-section conditionals don't inflate ChatMessage's complexity.
interface MessageBubbleProps {
  message: Message;
  supportingContextParsedContent?: ReturnType<
    typeof buildMessageData
  >['parsedContent'];
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
  isUser: boolean;
  isStreaming?: boolean;
  hasAttachments: boolean;
  bubbleStyle: StyleProp<ViewStyle>;
  parsedContent: ReturnType<typeof buildMessageData>['parsedContent'];
  showThinking: boolean;
  showSupportingContext: boolean;
  showActions: boolean;
  showGenerationDetails: boolean;
  hideProse?: boolean;
  metaExtra?: React.ReactNode;
  onImagePress?: (uri: string) => void;
  onTranscribeAgain?: ChatMessageProps['onTranscribeAgain'];
  onToggleThinking: () => void;
  onToggleSupportingContext: () => void;
  onLongPress: () => void;
  onMenuOpen: () => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  supportingContextParsedContent,
  styles,
  colors,
  isUser,
  isStreaming,
  hasAttachments,
  bubbleStyle,
  parsedContent,
  showThinking,
  showSupportingContext,
  showActions,
  showGenerationDetails,
  hideProse,
  metaExtra,
  onImagePress,
  onTranscribeAgain,
  onToggleThinking,
  onToggleSupportingContext,
  onLongPress,
  onMenuOpen,
}) => {
  const timelineHasThinking = Boolean(
    message.timeline?.some(entry => entry.kind === 'thinking'),
  );
  const timelineHasTools = Boolean(
    message.timeline?.some(entry => entry.kind === 'tool'),
  );
  const hasAssistantWork = Boolean(
    !isUser &&
      (message.timeline?.length ||
        message.toolArtifacts?.length ||
        parsedContent.thinking ||
        supportingContextParsedContent?.thinking),
  );
  const answerParsedContent = hasAssistantWork
    ? { ...parsedContent, thinking: '' }
    : parsedContent;
  return (
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
      {hasAssistantWork && (
        <View style={styles.toolCallReplyContent}>
          <Accordion
            key={isStreaming ? 'live' : 'done'}
            title={
              isStreaming
                ? 'Working'
                : message.turnStatus === 'cancelled'
                  ? 'Work stopped'
                  : 'Work done'
            }
            defaultOpen={Boolean(isStreaming)}
            variant="plain"
            testID="assistant-work-toggle"
          >
            {!!message.timeline?.length && (
              <SyncedAssistantTimeline
                message={message}
                styles={styles}
                colors={colors}
              />
            )}
            {!!message.toolArtifacts?.length && !timelineHasTools && (
              <SyncedToolArtifacts
                message={message}
                styles={styles}
                colors={colors}
              />
            )}
            {!!parsedContent.thinking &&
              (!timelineHasThinking || parsedContent.thinkingLabel) && (
                <ThinkingBlock
                  parsedContent={parsedContent}
                  showThinking={showThinking}
                  onToggle={onToggleThinking}
                  styles={styles}
                />
              )}
            {!!supportingContextParsedContent?.thinking && (
              <ThinkingBlock
                parsedContent={supportingContextParsedContent}
                showThinking={showSupportingContext}
                onToggle={onToggleSupportingContext}
                styles={styles}
              />
            )}
          </Accordion>
        </View>
      )}

      {(!hideProse || hasAttachments) && (
        <View
          testID={message.isThinking ? undefined : 'message-bubble'}
          style={message.isThinking ? undefined : bubbleStyle}
        >
          {hasAttachments && (
            <MessageAttachments
              attachments={message.attachments!}
              isUser={isUser}
              styles={styles}
              colors={colors}
              onImagePress={onImagePress}
              onTranscribeAgain={
                onTranscribeAgain
                  ? attachment => onTranscribeAgain(message, attachment)
                  : undefined
              }
            />
          )}

          <MessageContent
            isUser={isUser}
            isThinking={message.isThinking}
            content={message.content}
            isStreaming={isStreaming}
            parsedContent={answerParsedContent}
            showThinking={showThinking}
            onToggleThinking={onToggleThinking}
            styles={styles}
          />
        </View>
      )}

      {!message.isThinking && !isStreaming && !hideProse && (
        <MessageMetaRow
          message={message}
          styles={styles}
          isStreaming={isStreaming}
          showActions={showActions}
          onMenuOpen={onMenuOpen}
          metaExtra={metaExtra}
        />
      )}

      {!hideProse && (
        <RoutedToolsRow
          message={message}
          isUser={isUser}
          isStreaming={isStreaming}
          styles={styles}
          colors={colors}
        />
      )}

      {!hideProse &&
        !isUser &&
        !isStreaming &&
        message.generationMeta?.truncated && (
          <View testID="message-cutoff-indicator" style={styles.toolStatusRow}>
            <Icon name="alert-triangle" size={12} color={colors.textMuted} />
            <Text style={styles.toolStatusText}>
              Reply cut off at the token limit. Retry to continue.
            </Text>
          </View>
        )}

      {!hideProse &&
        showGenerationDetails &&
        !isUser &&
        message.generationMeta && (
          <GenerationMeta
            messageId={message.id}
            generationMeta={message.generationMeta}
            styles={styles}
            colors={colors}
          />
        )}
    </TouchableOpacity>
  );
};

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  supportingContext,
  isStreaming: isStreamingProp,
  onImagePress,
  onCopy,
  onRetry,
  onEdit,
  onTranscribeAgain,
  onGenerateImage,
  showActions = true,
  canGenerateImage = false,
  canSpeak: canSpeakProp = false,
  onSpeak: onSpeakProp,
  showGenerationDetails = false,
  animateEntry = false,
  hideProse,
  metaExtra,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const ttsCanSpeak = callHook<boolean>(HOOKS.audioCanSpeak) ?? false;
  const isStreaming = Boolean(isStreamingProp || message.isStreaming);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showThinking, setShowThinking] = useState(!!isStreaming);
  const [showSupportingContext, setShowSupportingContext] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const { displayContent, parsedContent } = buildMessageData(message);
  const supportingContextParsedContent = supportingContext
    ? buildMessageData(supportingContext).parsedContent
    : undefined;
  const isUser = message.role === 'user';
  const hasAttachments = Boolean(message.attachments?.length);
  const isSupportingContext =
    !isStreaming &&
    !hasAttachments &&
    isSupportingChatContext({
      answer: parsedContent.response,
      reasoning: parsedContent.thinking,
      reasoningLabel: parsedContent.thinkingLabel,
    });
  const bubbleStyle = [
    styles.bubble,
    isUser ? styles.userBubble : styles.assistantBubble,
    hasAttachments ? styles.bubbleWithAttachments : undefined,
  ];

  const handleCopy = () => {
    Clipboard.setString(displayContent);
    triggerHaptic('notificationSuccess');
    onCopy?.(displayContent);
    setShowActionMenu(false);
    setAlertState(showAlert('Copied', 'Message copied to clipboard'));
  };

  const handleRetry = () => {
    onRetry?.(message);
    setShowActionMenu(false);
  };

  const handleEdit = () => {
    setShowActionMenu(false);
    setTimeout(() => setIsEditing(true), 350);
  };

  const handleSaveEdit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed !== (isUser ? message.content : displayContent))
      onEdit?.(message, trimmed);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleLongPress = () => {
    if (!showActions || isStreaming) return;
    triggerHaptic('impactMedium');
    setShowActionMenu(true);
  };

  const handleGenerateImage = () => {
    const source = isUser ? message.content : parsedContent.response;
    onGenerateImage?.(source.trim().slice(0, 500));
    setShowActionMenu(false);
  };

  const canSpeak = !isUser && !isStreaming && (canSpeakProp || ttsCanSpeak);

  const handleSpeak = () => {
    setShowActionMenu(false);
    if (onSpeakProp) {
      onSpeakProp();
      return;
    }
    callHook(HOOKS.audioSpeak, displayContent, message.id);
  };

  if (message.isSystemInfo) {
    return (
      <SystemInfoMessage
        content={displayContent}
        styles={styles}
        alertState={alertState}
        onCloseAlert={() => setAlertState(hideAlert())}
      />
    );
  }
  if (message.role === 'tool')
    return (
      <ToolResultMessage message={message} styles={styles} colors={colors} />
    );
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return (
      <ToolCallWithThinking
        message={message}
        showThinking={showThinking}
        onToggle={() => setShowThinking(!showThinking)}
        styles={styles}
        colors={colors}
        hideProse={hideProse}
      />
    );
  }
  if (isSupportingContext) {
    const supportingContextView = (
      <View
        testID="assistant-message"
        style={[styles.container, styles.assistantContainer]}
      >
        <View style={styles.toolCallReplyContent}>
          <Accordion
            title={
              message.turnStatus === 'cancelled'
                ? 'Work stopped'
                : 'Work done'
            }
            variant="plain"
            testID="assistant-work-toggle"
          >
            <ThinkingBlock
              parsedContent={parsedContent}
              showThinking={showThinking}
              onToggle={() => setShowThinking(!showThinking)}
              styles={styles}
            />
          </Accordion>
        </View>
      </View>
    );
    return animateEntry ? (
      <AnimatedEntry index={0}>{supportingContextView}</AnimatedEntry>
    ) : (
      supportingContextView
    );
  }
  const messageBody = (
    <MessageBubble
      message={message}
      supportingContextParsedContent={supportingContextParsedContent}
      styles={styles}
      colors={colors}
      isUser={isUser}
      isStreaming={isStreaming}
      hasAttachments={hasAttachments}
      bubbleStyle={bubbleStyle}
      parsedContent={parsedContent}
      showThinking={showThinking}
      showSupportingContext={showSupportingContext}
      showActions={showActions}
      showGenerationDetails={showGenerationDetails}
      hideProse={hideProse}
      metaExtra={metaExtra}
      onImagePress={onImagePress}
      onTranscribeAgain={onTranscribeAgain}
      onToggleThinking={() => setShowThinking(!showThinking)}
      onToggleSupportingContext={() =>
        setShowSupportingContext(!showSupportingContext)
      }
      onLongPress={handleLongPress}
      onMenuOpen={() => setShowActionMenu(true)}
    />
  );

  return (
    <>
      {animateEntry ? (
        <AnimatedEntry index={0}>{messageBody}</AnimatedEntry>
      ) : (
        messageBody
      )}

      <MessageOverlays
        message={message}
        styles={styles}
        colors={colors}
        showActionMenu={showActionMenu}
        isEditing={isEditing}
        isUser={isUser}
        canEdit={!!onEdit}
        canRetry={!!onRetry}
        canGenerateImage={canGenerateImage && !!onGenerateImage}
        canSpeak={canSpeak}
        displayContent={displayContent}
        alertState={alertState}
        onCloseActionMenu={() => setShowActionMenu(false)}
        onCopy={handleCopy}
        onEdit={handleEdit}
        onRetry={handleRetry}
        onGenerateImage={handleGenerateImage}
        onSpeak={handleSpeak}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={handleCancelEdit}
        onCloseAlert={() => setAlertState(hideAlert())}
      />
    </>
  );
};
