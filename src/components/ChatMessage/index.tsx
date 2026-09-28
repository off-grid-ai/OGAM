import { CHAT_RESPONSE_STOPPED_EARLY_LABEL } from '@offgrid/models';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Clipboard } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme, useThemedStyles } from '../../theme';
import { useSpeechProjection } from '../../hooks/useApplicationProjection';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import Icon from 'react-native-vector-icons/Feather';
import {
  showAlert,
  hideAlert,
  AlertState,
  initialAlertState,
} from '../CustomAlert';
import { AnimatedEntry } from '../AnimatedEntry';
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
import { isSupportingChatContext } from '@offgrid/application';

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
  metaExtra?: React.ReactNode;
  onImagePress?: (uri: string) => void;
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
  metaExtra,
  onImagePress,
  onToggleThinking,
  onToggleSupportingContext,
  onLongPress,
  onMenuOpen,
}) => {
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
      <View testID="message-bubble" style={bubbleStyle}>
        {!!supportingContextParsedContent?.thinking && (
          <ThinkingBlock
            parsedContent={supportingContextParsedContent}
            showThinking={showSupportingContext}
            onToggle={onToggleSupportingContext}
            styles={styles}
          />
        )}

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

      <SyncedToolArtifacts message={message} styles={styles} colors={colors} />

      <RoutedToolsRow
        message={message}
        isUser={isUser}
        isStreaming={isStreaming}
        styles={styles}
        colors={colors}
      />

      {/* The words come from the shared chat rules, so the screen keeps no wording of its own. */}
      {!isUser && !isStreaming && message.stoppedEarly && (
        <View testID="message-stopped-early" style={styles.toolStatusRow}>
          <Icon name="alert-triangle" size={12} color={colors.textMuted} />
          <Text style={styles.toolStatusText}>
            {CHAT_RESPONSE_STOPPED_EARLY_LABEL}
          </Text>
        </View>
      )}

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
        <GenerationMeta
          generationMeta={message.generationMeta}
          styles={styles}
        />
      )}
    </TouchableOpacity>
  );
};

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  supportingContext,
  isStreaming,
  onImagePress,
  onCopy,
  onRetry,
  onEdit,
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
  const voiceMode = useSpeechProjection().preferences.voiceMode;
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showSelectText, setShowSelectText] = useState(false);
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

  const handleSelectText = () => {
    setShowActionMenu(false);
    // Let the action sheet finish closing before opening the select-text sheet.
    setTimeout(() => setShowSelectText(true), 350);
  };

  // The candidate comes from the sheet that owns the draft, so this can never judge a stale
  // value from an earlier render.
  const handleSaveEdit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed !== message.content) onEdit?.(message, trimmed);
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

  // A tool row can also be system info (kept out of the prompt): render it as the tool row.
  if (message.role === 'tool')
    return (
      <ToolResultMessage message={message} styles={styles} colors={colors} />
    );
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
        <View testID="message-bubble" style={bubbleStyle}>
          <ThinkingBlock
            parsedContent={parsedContent}
            showThinking={showThinking}
            onToggle={() => setShowThinking(!showThinking)}
            styles={styles}
          />
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
      metaExtra={metaExtra}
      onImagePress={onImagePress}
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
        showSelectText={showSelectText}
        isEditing={isEditing}
        isUser={isUser}
        canEdit={!!onEdit}
        canRetry={!!onRetry}
        canGenerateImage={canGenerateImage && !!onGenerateImage}
        canSpeak={canSpeak}
        showSelectTextAction={!voiceMode}
        displayContent={displayContent}
        alertState={alertState}
        onCloseActionMenu={() => setShowActionMenu(false)}
        onCloseSelectText={() => setShowSelectText(false)}
        onCopy={handleCopy}
        onEdit={handleEdit}
        onRetry={handleRetry}
        onGenerateImage={handleGenerateImage}
        onSpeak={handleSpeak}
        onSelectText={handleSelectText}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={handleCancelEdit}
        onCloseAlert={() => setAlertState(hideAlert())}
      />
    </>
  );
};
