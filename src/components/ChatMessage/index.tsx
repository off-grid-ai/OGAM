import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Clipboard } from 'react-native';
import { useTheme, useThemedStyles } from '../../theme';
import { useUiModeStore, useAccordionExpanded } from '../../stores';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import Icon from 'react-native-vector-icons/Feather';
import {
  CustomAlert,
  showAlert,
  hideAlert,
  AlertState,
  initialAlertState,
} from '../CustomAlert';
import { AnimatedEntry } from '../AnimatedEntry';
import { triggerHaptic } from '../../utils/haptics';
import { createStyles } from './styles';
import { MessageOverlays } from './components/MessageOverlays';
import { MarkdownText } from '../MarkdownText';
import { buildMessageData } from './utils';
import { ThinkingBlock } from './components/ThinkingBlock';
import type { ChatMessageProps } from './types';
import type { Message } from '../../types';
import { prepareMessageForSpeech } from '../../utils/messageContent';
import { MessageBubble } from './MessageBubble';

function getToolIcon(toolName?: string): string {
  switch (toolName) {
    case 'web_search':
      return 'globe';
    case 'calculator':
      return 'hash';
    case 'get_current_datetime':
      return 'clock';
    case 'get_device_info':
      return 'smartphone';
    default:
      return 'tool';
  }
}

function getToolLabel(toolName?: string, content?: string): string {
  switch (toolName) {
    case 'web_search': {
      const queryMatch = content
        ? /^No results found for "([^"]+)"/.exec(content)
        : null;
      if (queryMatch) return `Searched: "${queryMatch[1]}" (no results)`;
      return 'Web search result';
    }
    case 'calculator':
      return content || 'Calculated';
    case 'get_current_datetime':
      return 'Retrieved date/time';
    case 'get_device_info':
      return 'Retrieved device info';
    default:
      return toolName || 'Tool result';
  }
}

type ToolResultBubbleProps = {
  /** Stable identity for persisting expanded state across the streaming→finalized
   *  remount (not the message id, which changes on finalize). */
  stableKey: string;
  toolIcon: string;
  toolLabel: string;
  toolName: string;
  durationLabel: string;
  content: string;
  hasDetails: boolean;
  styles: ReturnType<typeof createStyles>;
  colors: any;
};

const ToolResultBubbleInner: React.FC<ToolResultBubbleProps> = ({
  stableKey,
  toolIcon,
  toolLabel,
  toolName,
  durationLabel,
  content,
  hasDetails,
  styles,
  colors,
}) => {
  const [expanded, toggle] = useAccordionExpanded(`tool-result:${stableKey}`);
  return (
    <View testID="tool-message" style={styles.systemInfoContainer}>
      <TouchableOpacity
        style={styles.toolStatusRow}
        onPress={hasDetails ? toggle : undefined}
        activeOpacity={hasDetails ? 0.6 : 1}
        disabled={!hasDetails}
      >
        <Icon name={toolIcon} size={13} color={colors.textMuted} />
        <Text
          style={styles.toolStatusText}
          numberOfLines={expanded ? undefined : 2}
          testID={`tool-result-label-${toolName || 'unknown'}`}
        >
          {toolLabel}
          {durationLabel}
        </Text>
        {hasDetails && (
          <Icon
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            color={colors.textMuted}
          />
        )}
      </TouchableOpacity>
      {expanded && hasDetails && (
        <View style={styles.toolDetailContainer}>
          <MarkdownText dimmed>{content}</MarkdownText>
        </View>
      )}
    </View>
  );
};

/**
 * Memoized so token churn on a streaming sibling (which re-renders the chat subtree
 * every token) does not re-render this row and reset its TouchableOpacity press target
 * mid-gesture — the tap-during-streaming drop in bug #37. Props are stable for a
 * finalized tool-result message; the expanded flag lives in accordionStore so a real
 * toggle still re-renders it.
 */
const ToolResultBubble = React.memo(ToolResultBubbleInner);

const ToolResultMessage: React.FC<{
  message: Message;
  styles: any;
  colors: any;
}> = ({ message, styles, colors }) => {
  const toolIcon = getToolIcon(message.toolName);
  const toolLabel = getToolLabel(message.toolName, message.content);
  const durationLabel =
    message.generationTimeMs == null ? '' : ` (${message.generationTimeMs}ms)`;
  const hasDetails = !!(
    message.content &&
    message.content.length > 0 &&
    !message.content.startsWith('No results')
  );
  // Prefer toolCallId (carried on every tool-result message and stable across the
  // streaming→finalized remount); fall back to the message id.
  const stableKey = message.toolCallId || message.id;
  return (
    <ToolResultBubble
      stableKey={stableKey}
      toolIcon={toolIcon}
      toolLabel={toolLabel}
      toolName={message.toolName || 'unknown'}
      durationLabel={durationLabel}
      content={message.content}
      hasDetails={hasDetails}
      styles={styles}
      colors={colors}
    />
  );
};

const ToolCallMessage: React.FC<{
  message: Message;
  styles: any;
  colors: any;
}> = ({ message, styles, colors }) => (
  <View testID="tool-call-message" style={styles.systemInfoContainer}>
    {message.toolCalls?.map((tc, i) => {
      let argsPreview = '';
      try {
        argsPreview = Object.values(JSON.parse(tc.arguments)).join(', ');
      } catch {
        argsPreview = tc.arguments;
      }
      return (
        <View key={`${tc.id || i}`} style={styles.toolStatusRow}>
          <Icon name={getToolIcon(tc.name)} size={13} color={colors.primary} />
          <Text
            style={[styles.toolStatusText, { color: colors.primary }]}
            numberOfLines={1}
          >
            Using {tc.name}
            {argsPreview ? `: ${argsPreview}` : ''}
          </Text>
        </View>
      );
    })}
  </View>
);

const SystemInfoMessage: React.FC<{
  content: string;
  styles: ReturnType<typeof createStyles>;
  alertState: AlertState;
  onCloseAlert: () => void;
}> = ({ content, styles, alertState, onCloseAlert }) => (
  <>
    <View testID="system-info-message" style={styles.systemInfoContainer}>
      <Text style={styles.systemInfoText}>{content}</Text>
    </View>
    <CustomAlert
      visible={alertState.visible}
      title={alertState.title}
      message={alertState.message}
      buttons={alertState.buttons}
      onClose={onCloseAlert}
    />
  </>
);

const ToolCallWithThinking: React.FC<{
  message: Message;
  showThinking: boolean;
  onToggle: () => void;
  styles: any;
  colors: any;
}> = ({ message, showThinking, onToggle, styles, colors }) => {
  // Use buildMessageData (the single source that honors message.reasoningContent from the
  // separate reasoning channel AND inline <think> in content) so a tool-call message keeps
  // its pre-tool-call thinking block. Reading only parseThinkingContent(content) missed the
  // reasoningContent case → the first round of thinking vanished when the tool fired (OD14).
  const tc =
    message.content || message.reasoningContent
      ? buildMessageData(message).parsedContent
      : null;
  const hasText = !!tc?.response?.trim();
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

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
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
  metaExtra,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const ttsCanSpeak = callHook<boolean>(HOOKS.audioCanSpeak) ?? false;
  const interfaceMode = useUiModeStore(s => s.interfaceMode);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showSelectText, setShowSelectText] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(message.content);
  const [showThinking, setShowThinking] = useState(!!isStreaming);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const { displayContent, parsedContent } = buildMessageData(message);

  const isUser = message.role === 'user';
  const hasAttachments = Boolean(message.attachments?.length);
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
    setEditedContent(message.content);
    setShowActionMenu(false);
    setTimeout(() => setIsEditing(true), 350);
  };

  const handleSelectText = () => {
    setShowActionMenu(false);
    // Let the action sheet finish closing before opening the select-text sheet.
    setTimeout(() => setShowSelectText(true), 350);
  };

  const handleSaveEdit = () => {
    const trimmed = editedContent.trim();
    if (trimmed !== message.content) onEdit?.(message, trimmed);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditedContent(message.content);
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
    callHook(
      HOOKS.audioSpeak,
      prepareMessageForSpeech(displayContent),
      message.id,
    );
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
      />
    );
  }
  const messageBody = (
    <MessageBubble
      message={message}
      styles={styles}
      colors={colors}
      isUser={isUser}
      isStreaming={isStreaming}
      hasAttachments={hasAttachments}
      bubbleStyle={bubbleStyle}
      parsedContent={parsedContent}
      showThinking={showThinking}
      showActions={showActions}
      showGenerationDetails={showGenerationDetails}
      metaExtra={metaExtra}
      onImagePress={onImagePress}
      onToggleThinking={() => setShowThinking(!showThinking)}
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
        showSelectTextAction={interfaceMode === 'chat'}
        displayContent={displayContent}
        alertState={alertState}
        onCloseActionMenu={() => setShowActionMenu(false)}
        onCloseSelectText={() => setShowSelectText(false)}
        onChangeEditText={setEditedContent}
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
