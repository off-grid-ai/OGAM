import { CitationChips } from '../CitationChips';
import { sourcesFromSearch, type CheckedCitation } from '../../study/citations';
import { quoteForAsk, useQuoteDraft } from '../../utils/quoteDraft';
import { whyThisReply } from '../../study/whyReply';
import { sourcesBefore, citedNumbers, markSources } from '../../study/replySources';
import React, { useMemo, useState } from 'react';
import { Alert, View, Text, TouchableOpacity, Clipboard } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme, useThemedStyles } from '../../theme';
import { useUiModeStore, useAccordionExpanded, useAppStore, useChatStore } from '../../stores';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import Icon from 'react-native-vector-icons/Feather';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../CustomAlert';
import { AnimatedEntry } from '../AnimatedEntry';
import { triggerHaptic } from '../../services/haptics';
import { createStyles } from './styles';
import { useWideLayout } from '../../hooks/useWideLayout';
import { MessageAttachments } from './components/MessageAttachments';
import { MessageContent } from './components/MessageContent';
import { GenerationMeta } from './components/GenerationMeta';
import { ToolsSentCollapsible } from './components/ToolsSentCollapsible';
import { MessageOverlays } from './components/MessageOverlays';
import { MarkdownText } from '../MarkdownText';
import { formatTime, formatDuration, buildMessageData } from './utils';
import { ThinkingBlock } from './components/ThinkingBlock';
import type { ChatMessageProps } from './types';
import type { Message } from '../../types';
import { applyMessageLook, messageTime } from '../../theme/messageLooks';
import { usePins } from '../../pins/store';
import { slidesFromReply } from '../../presentations/replySlides';

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
  stableKey, toolIcon, toolLabel, toolName, durationLabel, content, hasDetails, styles, colors,
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
      {hasDetails && (toolName === 'web_search') && <CitationChips cites={sourcesFromSearch(content)} />}
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

/** Renders the routed-tools collapsible for a finished assistant message, or nothing. */
const RoutedToolsRow: React.FC<{ message: Message; isUser: boolean; isStreaming?: boolean; styles: any; colors: any }> = ({ message, isUser, isStreaming, styles, colors }) => {
  const names = message.generationMeta?.routedToolNames;
  if (isUser || isStreaming || !names?.length) return null;
  // This row only renders on a finalized assistant message (isStreaming is false),
  // so message.id is already the real, stable id here.
  return <ToolsSentCollapsible names={names} stableKey={message.id} styles={styles} colors={colors} />;
};

const ToolResultMessage: React.FC<{ message: Message; styles: any; colors: any }> = ({ message, styles, colors }) => {
  const toolIcon = getToolIcon(message.toolName);
  const toolLabel = getToolLabel(message.toolName, message.content);
  const durationLabel = message.generationTimeMs == null ? '' : ` (${message.generationTimeMs}ms)`;
  const hasDetails = !!(message.content && message.content.length > 0 && !message.content.startsWith('No results'));
  // Prefer toolCallId (carried on every tool-result message and stable across the
  // streaming→finalized remount); fall back to the message id.
  const stableKey = message.toolCallId || message.id;
  return <ToolResultBubble stableKey={stableKey} toolIcon={toolIcon} toolLabel={toolLabel} toolName={message.toolName || 'unknown'} durationLabel={durationLabel} content={message.content} hasDetails={hasDetails} styles={styles} colors={colors} />;
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
  // Use buildMessageData (the single source that honors message.reasoningContent from the
  // separate reasoning channel AND inline <think> in content) so a tool-call message keeps
  // its pre-tool-call thinking block. Reading only parseThinkingContent(content) missed the
  // reasoningContent case → the first round of thinking vanished when the tool fired (OD14).
  const tc = (message.content || message.reasoningContent)
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
    </View>
  );
};

// The rendered message bubble (attachments + content + tool row + meta). Split out of
// ChatMessage so its per-section conditionals don't inflate ChatMessage's complexity.
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
  /** Clean chat layout: smaller gaps between messages. */
  clean?: boolean;
  /** A name shown above the message (Discord style). */
  label?: string;
  /** Learned lessons the reply was written with, shown as a small note under it. */
  lessonsUsed?: string[];
  /** Numbered sources the reply cites, listed under it. */
  sources?: CheckedCitation[];
  /** The message's time, shown inside the bubble in a messaging-app look. */
  time?: string;
  timeStyle?: object;
}

/** The bubble's styles: Clean = plain-text replies and a rounded bubble for your own message; Bubbles = every message boxed. */
function bubbleStyleFor(o: { styles: any; isUser: boolean; clean: boolean; isWide: boolean; hasAttachments: boolean }) {
  const { styles, isUser, clean, isWide, hasAttachments } = o;
  const base = [styles.bubble, isUser ? styles.userBubble : styles.assistantBubble];
  const width = isWide ? { maxWidth: isUser ? '70%' as const : '92%' as const } : undefined;
  if (clean) return [...base, isUser ? styles.cleanUserBubble : styles.cleanAssistantBubble, isUser ? width : undefined, hasAttachments ? styles.bubbleWithAttachments : undefined];
  return [...base, width, hasAttachments ? styles.bubbleWithAttachments : undefined];
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message, styles, colors, isUser, isStreaming, hasAttachments, bubbleStyle,
  parsedContent, showThinking, showActions, showGenerationDetails, metaExtra,
  onImagePress, onToggleThinking, onLongPress, onMenuOpen, clean, label, lessonsUsed, sources, time, timeStyle,
}) => (
  <TouchableOpacity
    testID={isUser ? 'user-message' : 'assistant-message'}
    style={[
      styles.container,
      clean ? styles.cleanContainer : undefined,
      isUser ? styles.userContainer : styles.assistantContainer,
    ]}
    activeOpacity={0.8}
    onLongPress={onLongPress}
    delayLongPress={300}
  >
    <View style={bubbleStyle}>
      {!!label && <Text style={styles.lookLabel}>{label}</Text>}
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
      {!!time && <Text style={timeStyle} testID="look-time">{time}</Text>}
    </View>

    <RoutedToolsRow message={message} isUser={isUser} isStreaming={isStreaming} styles={styles} colors={colors} />

    {!isUser && !isStreaming && message.generationMeta?.truncated && (
      <View testID="message-cutoff-indicator" style={styles.toolStatusRow}>
        <Icon name="alert-triangle" size={12} color={colors.textMuted} />
        <Text style={styles.toolStatusText}>Reply cut off at the token limit. Retry to continue.</Text>
      </View>
    )}

    {!!sources?.length && <CitationChips cites={sources} testID="reply-sources" />}

    {!!lessonsUsed?.length && (
      <View style={styles.toolStatusRow} testID="lessons-used">
        <Icon name="award" size={12} color={colors.textMuted} />
        <Text style={styles.toolStatusText}>Used: {lessonsUsed.join(' and ')} lessons</Text>
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

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  isStreaming,
  onImagePress,
  onCopy,
  onRetry,
  onEdit,
  onCheckAnswer,
  onDelete,
  onSaveToProject,
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

  const { displayContent, parsedContent: rawParsed } = buildMessageData(message);
  // Source numbers: a reply that cites a search result as [1] shows a small raised 1 and lists the sources under it.
  const sources = useMemo(() => {
    if (message.role !== 'assistant' || !/\[\d{1,2}\]/.test(rawParsed.response ?? '')) return [];
    const chat = useChatStore.getState();
    const msgs = chat.conversations.find((c: { id: string }) => c.id === chat.activeConversationId)?.messages ?? [];
    const searched = sourcesBefore(msgs as any, message.id);
    if (searched.length) return searched;
    // No web search led to this reply: the numbers refer to the project-document excerpts it was written from.
    return (message.generationMeta?.sources ?? []).map((s) => ({ title: s.title, quote: s.quote, file: s.file, verified: true }));
  }, [message.id, message.role, rawParsed.response, message.generationMeta?.sources]);
  const cited = citedNumbers(rawParsed.response ?? '', sources.length).length > 0;
  const parsedContent = cited ? { ...rawParsed, response: markSources(rawParsed.response ?? '', sources.length) } : rawParsed;

  const isUser = message.role === 'user';
  const hasAttachments = Boolean(message.attachments?.length);
  // Tablet/unfolded column: shorter user bubbles, more room for long answers and code.
  const { isWide } = useWideLayout();
  const layout = useAppStore((s) => s.settings.appearance?.chatLayout ?? 'clean');
  const showLessons = useAppStore((s) => s.settings.showLessonsUsed !== false);
  const clean = layout === 'clean';
  const { look, lookStyles, timeStyle } = applyMessageLook({ layout, isUser, background: colors.background, styles });
  const bubbleStyle = look ? [...bubbleStyleFor({ styles, isUser, clean: false, isWide, hasAttachments }), look.bubble] : bubbleStyleFor({ styles, isUser, clean, isWide, hasAttachments });

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

  const handleDelete = () => {
    setShowActionMenu(false);
    onDelete?.(message);
  };
  const pinned = usePins((st) => st.pins.some((p) => p.id === message.id));
  const handlePin = () => {
    setShowActionMenu(false);
    if (pinned) { usePins.getState().remove(message.id); return; }
    const chat = useChatStore.getState();
    const conversation = chat.conversations.find((c: { id: string }) => c.id === chat.activeConversationId);
    usePins.getState().add({ id: message.id, text: displayContent, role: message.role, conversationId: conversation?.id ?? null, conversationTitle: conversation?.title ?? 'Chat' });
    triggerHaptic('notificationSuccess');
  };
  const handleAsk = () => {
    setShowActionMenu(false);
    useQuoteDraft.getState().set(quoteForAsk(displayContent));
  };
  const handleWhy = () => {
    setShowActionMenu(false);
    const why = whyThisReply(message.generationMeta);
    Alert.alert('Why this reply', why || 'Nothing was recorded about what this reply was written from.');
  };
  const handleCheck = () => {
    setShowActionMenu(false);
    setTimeout(() => onCheckAnswer?.(message), 350); // let the menu finish closing
  };

  const handleSlides = () => {
    setShowActionMenu(false);
    const chat = useChatStore.getState();
    const title = chat.conversations.find((c: { id: string }) => c.id === chat.activeConversationId)?.title;
    const made = slidesFromReply(displayContent, title);
    // Loaded when used: screens that mock the navigation library do not need it.
    require('../../utils/navigationRef').navigationRef.navigate('Presentations', { slides: made.slides, name: made.name });
  };

  const handleSaveToProject = () => {
    setShowActionMenu(false);
    onSaveToProject?.(message);
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

  /** `resend` false only fixes the text: the conversation after it is kept and nothing is sent again. */
  const handleSaveEdit = (resend = true) => {
    const trimmed = editedContent.trim();
    if (trimmed !== message.content) { if (resend) onEdit?.(message, trimmed); else onEdit?.(message, trimmed, { resend: false }); }
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
    <MessageBubble
      clean={clean}
      label={look?.label ? `${look.label} · ${messageTime(message.timestamp)}` : undefined}
      lessonsUsed={!isUser && showLessons ? message.generationMeta?.lessonsUsed : undefined}
      sources={cited ? sources : undefined}
      time={look && !look.label ? messageTime(message.timestamp) : undefined}
      timeStyle={timeStyle}
      message={message}
      styles={lookStyles}
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
      {animateEntry ? <AnimatedEntry index={0}>{messageBody}</AnimatedEntry> : messageBody}

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
        canDelete={!!onDelete && !isStreaming}
        canSaveToProject={!!onSaveToProject && !isUser && !isStreaming}
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
        onDelete={handleDelete}
        onSaveToProject={handleSaveToProject}
        extras={{ pinned, onPin: handlePin, onSlides: isStreaming ? undefined : handleSlides, onCheck: isStreaming || !onCheckAnswer ? undefined : handleCheck, onWhy: isStreaming ? undefined : handleWhy, onAsk: isStreaming ? undefined : handleAsk }}
        onGenerateImage={handleGenerateImage}
        onSpeak={handleSpeak}
        onSelectText={handleSelectText}
        onSaveEditOnly={isUser ? () => handleSaveEdit(false) : undefined}
        onSaveEdit={() => handleSaveEdit(!isUser ? false : true)}
        onCancelEdit={handleCancelEdit}
        onCloseAlert={() => setAlertState(hideAlert())}
      />
    </>
  );
};