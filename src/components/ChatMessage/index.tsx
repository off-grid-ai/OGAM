import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Clipboard } from 'react-native';
import { useTheme, useThemedStyles } from '../../theme';
import { useUiModeStore } from '../../stores';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import Icon from 'react-native-vector-icons/Feather';
import { stripControlTokens } from '../../utils/messageContent';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../CustomAlert';
import { AnimatedEntry } from '../AnimatedEntry';
import { triggerHaptic } from '../../utils/haptics';
import { createStyles } from './styles';
import { MessageAttachments } from './components/MessageAttachments';
import { MessageContent } from './components/MessageContent';
import { GenerationMeta } from './components/GenerationMeta';
import { ActionMenuSheet, EditSheet, SelectTextSheet } from './components/ActionMenuSheet';
import { MarkdownText } from '../MarkdownText';
import { parseThinkingContent, formatTime, formatDuration, buildMessageData } from './utils';
import { ThinkingBlock } from './components/ThinkingBlock';
import type { ChatMessageProps } from './types';
import type { Message } from '../../types';

function getToolIcon(toolName?: string): string {
  switch (toolName) {
    case 'web_search': return 'globe';
    case 'calculator': return 'hash';
    case 'get_current_datetime': return 'clock';
    case 'get_device_info': return 'smartphone';
    default: return 'tool';
  }
}

function getToolLabel(toolName?: string, content?: string): string {
  switch (toolName) {
    case 'web_search': {
      const queryMatch = content ? /^No results found for "([^"]+)"/.exec(content) : null;
      if (queryMatch) return `Searched: "${queryMatch[1]}" (no results)`;
      return 'Web search result';
    }
    case 'calculator': return content || 'Calculated';
    case 'get_current_datetime': return 'Retrieved date/time';
    case 'get_device_info': return 'Retrieved device info';
    default: return toolName || 'Tool result';
  }
}


type ToolResultBubbleProps = {
  toolIcon: string;
  toolLabel: string;
  toolName: string;
  durationLabel: string;
  content: string;
  hasDetails: boolean;
  styles: ReturnType<typeof createStyles>;
  colors: any;
};

const ToolResultBubble: React.FC<ToolResultBubbleProps> = ({
  toolIcon, toolLabel, toolName, durationLabel, content, hasDetails, styles, colors,
}) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <View testID="tool-message" style={styles.systemInfoContainer}>
      <TouchableOpacity
        style={styles.toolStatusRow}
        onPress={hasDetails ? () => setExpanded(!expanded) : undefined}
        activeOpacity={hasDetails ? 0.6 : 1}
        disabled={!hasDetails}
      >
        <Icon name={toolIcon} size={13} color={colors.textMuted} />
        <Text style={styles.toolStatusText} numberOfLines={expanded ? undefined : 2} testID={`tool-result-label-${toolName || 'unknown'}`}>
          {toolLabel}{durationLabel}
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

const ToolResultMessage: React.FC<{ message: Message; styles: any; colors: any }> = ({ message, styles, colors }) => {
  const toolIcon = getToolIcon(message.toolName);
  const toolLabel = getToolLabel(message.toolName, message.content);
  const durationLabel = message.generationTimeMs == null ? '' : ` (${message.generationTimeMs}ms)`;
  const hasDetails = !!(message.content && message.content.length > 0 && !message.content.startsWith('No results'));
  return <ToolResultBubble toolIcon={toolIcon} toolLabel={toolLabel} toolName={message.toolName || 'unknown'} durationLabel={durationLabel} content={message.content} hasDetails={hasDetails} styles={styles} colors={colors} />;
};

const ToolCallMessage: React.FC<{ message: Message; styles: any; colors: any }> = ({ message, styles, colors }) => (
  <View testID="tool-call-message" style={styles.systemInfoContainer}>
    {message.toolCalls?.map((tc, i) => {
      let argsPreview = '';
      try { argsPreview = Object.values(JSON.parse(tc.arguments)).join(', '); } catch { argsPreview = tc.arguments; }
      return (
        <View key={`${tc.id || i}`} style={styles.toolStatusRow}>
          <Icon name={getToolIcon(tc.name)} size={13} color={colors.primary} />
          <Text style={[styles.toolStatusText, { color: colors.primary }]} numberOfLines={1}>
            Using {tc.name}{argsPreview ? `: ${argsPreview}` : ''}
          </Text>
        </View>
      );
    })}
  </View>
);

const SystemInfoMessage: React.FC<{
  content: string; styles: ReturnType<typeof createStyles>;
  alertState: AlertState; onCloseAlert: () => void;
}> = ({ content, styles, alertState, onCloseAlert }) => (
  <>
    <View testID="system-info-message" style={styles.systemInfoContainer}>
      <Text style={styles.systemInfoText}>{content}</Text>
    </View>
    <CustomAlert
      visible={alertState.visible} title={alertState.title}
      message={alertState.message} buttons={alertState.buttons}
      onClose={onCloseAlert}
    />
  </>
);

type MetaRowProps = {
  message: Message;
  styles: ReturnType<typeof createStyles>;
  isStreaming?: boolean;
  showActions: boolean;
  onMenuOpen: () => void;
  metaExtra?: React.ReactNode;
};

const MessageMetaRow: React.FC<MetaRowProps> = ({ message, styles, isStreaming, showActions, onMenuOpen, metaExtra }) => (
  <View style={styles.metaRow}>
    <Text style={styles.timestamp}>{formatTime(message.timestamp)}</Text>
    {message.generationTimeMs != null && message.role === 'assistant' && (
      <Text style={styles.generationTime}>{formatDuration(message.generationTimeMs)}</Text>
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
  message: Message; showThinking: boolean; onToggle: () => void; styles: any; colors: any;
}> = ({ message, showThinking, onToggle, styles, colors }) => {
  const tc = message.content ? parseThinkingContent(stripControlTokens(message.content)) : null;
  const hasText = !!tc?.response?.trim();
  return (
    <View style={styles.systemInfoContainer}>
      {!!tc?.thinking && (
        <View style={styles.thinkingBlockWrapper}>
          <ThinkingBlock parsedContent={tc} showThinking={showThinking} onToggle={onToggle} styles={styles} />
        </View>
      )}
      {hasText && (
        <View testID="tool-call-pre-text" style={styles.toolCallPreText}>
          <MarkdownText>{tc!.response}</MarkdownText>
        </View>
      )}
      <ToolCallMessage message={message} styles={styles} colors={colors} />
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
  const interfaceMode = useUiModeStore((s) => s.interfaceMode);
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
    callHook(HOOKS.audioSpeak, displayContent, message.id);
  };

  if (message.isSystemInfo) {
    return <SystemInfoMessage content={displayContent} styles={styles}
      alertState={alertState} onCloseAlert={() => setAlertState(hideAlert())} />;
  }
  if (message.role === 'tool') return <ToolResultMessage message={message} styles={styles} colors={colors} />;
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return <ToolCallWithThinking message={message} showThinking={showThinking}
      onToggle={() => setShowThinking(!showThinking)} styles={styles} colors={colors} />;
  }
  const messageBody = (
    <TouchableOpacity
      testID={isUser ? 'user-message' : 'assistant-message'}
      style={[
        styles.container,
        isUser ? styles.userContainer : styles.assistantContainer,
      ]}
      activeOpacity={0.8}
      onLongPress={handleLongPress}
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
          onToggleThinking={() => setShowThinking(!showThinking)}
          styles={styles}
        />
      </View>

      <MessageMetaRow
        message={message}
        styles={styles}
        isStreaming={isStreaming}
        showActions={showActions}
        onMenuOpen={() => setShowActionMenu(true)}
        metaExtra={metaExtra}
      />

      {showGenerationDetails && !isUser && message.generationMeta && (
        <GenerationMeta generationMeta={message.generationMeta} styles={styles} />
      )}
    </TouchableOpacity>
  );

  return (
    <>
      {animateEntry ? <AnimatedEntry index={0}>{messageBody}</AnimatedEntry> : messageBody}

      <ActionMenuSheet
        visible={showActionMenu}
        onClose={() => setShowActionMenu(false)}
        isUser={isUser}
        canEdit={!!onEdit}
        canRetry={!!onRetry}
        canGenerateImage={canGenerateImage && !!onGenerateImage}
        canSpeak={canSpeak}
        styles={styles}
        onCopy={handleCopy}
        onEdit={handleEdit}
        onRetry={handleRetry}
        onGenerateImage={handleGenerateImage}
        onSpeak={handleSpeak}
        onSelectText={interfaceMode === 'chat' ? handleSelectText : undefined}
      />
      <SelectTextSheet
        visible={showSelectText}
        onClose={() => setShowSelectText(false)}
        content={displayContent}
        styles={styles}
      />
      <EditSheet
        visible={isEditing}
        onClose={handleCancelEdit}
        defaultValue={message.content}
        onChangeText={setEditedContent}
        onSave={handleSaveEdit}
        onCancel={handleCancelEdit}
        styles={styles}
        colors={colors}
      />
      <CustomAlert visible={alertState.visible} title={alertState.title}
        message={alertState.message} buttons={alertState.buttons} onClose={() => setAlertState(hideAlert())} />
    </>
  );
};