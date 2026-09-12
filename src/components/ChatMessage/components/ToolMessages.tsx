/**
 * The tool-call surfaces of a chat message: what the model asked a tool to do, what came back, and
 * the routed-tools row above a reply.
 *
 * Extracted from ChatMessage, which had grown past the 500-line cap with these living inside it. They
 * are their own subject - a tool result is not a message bubble - and nothing here is shared with the
 * bubble beyond the styles object.
 */
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../../theme';
import { useAccordionExpanded } from '../../../stores';
import { SLOTS, useSlot } from '../../../bootstrap/slotRegistry';
import { CustomAlert, type AlertState } from '../../CustomAlert';
import { MarkdownText } from '../../MarkdownText';
import { ToolsSentCollapsible } from './ToolsSentCollapsible';
import type { createStyles } from '../styles';
import type { Message } from '../../../types';

function getToolIcon(toolName?: string): string {
  switch (toolName) {
    case 'web_search':
    case 'web_use':
      return 'globe';
    case 'computer_use':
      return 'monitor';
    case 'calculator':
      return 'hash';
    case 'get_current_datetime':
      return 'clock';
    case 'get_device_info':
      return 'smartphone';
    case 'context_compaction':
      return 'archive';
    case 'model_fallback':
      return 'shuffle';
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
    case 'web_use':
      return 'Web Use';
    case 'computer_use':
      return 'Computer Use';
    case 'context_compaction':
      return 'Context compacted';
    case 'model_fallback':
      return 'Model changed';
    default:
      return toolName || 'Tool result';
  }
}

function isTaskToolName(toolName?: string): boolean {
  return (
    toolName === 'web_use' ||
    toolName === 'computer_use'
  );
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
  /** A call still in flight reads in the accent colour; a finished one is muted. */
  active?: boolean;
  /**
   * What this row IS, named by whoever renders it. The layout is shared; the identity is not - a
   * call the model asked for and the result that came back are different facts, and a surface that
   * cannot tell them apart cannot assert on either.
   */
  rowTestID?: string;
  labelTestID?: string;
  /** This row is the head of a call/result pair, so it sits close to the row that answers it. */
  paired?: boolean;
  styles: ReturnType<typeof createStyles>;
  colors: any;
  detail?: React.ReactNode;
};

const ToolResultBubbleInner: React.FC<ToolResultBubbleProps> = ({
  stableKey,
  toolIcon,
  toolLabel,
  toolName,
  durationLabel,
  content,
  hasDetails,
  active = false,
  rowTestID = 'tool-message',
  labelTestID,
  paired = false,
  styles,
  colors,
  detail,
}) => {
  const [expanded, toggle] = useAccordionExpanded(`tool-result:${stableKey}`);
  const tone = active ? colors.primary : colors.textMuted;
  return (
    <View
      testID={rowTestID}
      style={paired ? styles.toolRowPaired : styles.toolRow}
    >
      <TouchableOpacity
        style={styles.toolStatusRow}
        onPress={hasDetails ? toggle : undefined}
        activeOpacity={hasDetails ? 0.6 : 1}
        disabled={!hasDetails}
        testID={`tool-result-accordion-${toolName || 'unknown'}`}
      >
        <Icon name={toolIcon} size={13} color={tone} />
        <Text
          style={[styles.toolStatusText, { color: tone }]}
          numberOfLines={expanded ? undefined : 2}
          testID={labelTestID ?? `tool-result-label-${toolName || 'unknown'}`}
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
          {detail ?? <MarkdownText dimmed>{content}</MarkdownText>}
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
export const RoutedToolsRow: React.FC<{
  message: Message;
  isUser: boolean;
  isStreaming?: boolean;
  styles: any;
  colors: any;
}> = ({ message, isUser, isStreaming, styles, colors }) => {
  const names = message.generationMeta?.routedToolNames;
  if (isUser || isStreaming || !names?.length) return null;
  // This row only renders on a finalized assistant message (isStreaming is false),
  // so message.id is already the real, stable id here.
  return (
    <ToolsSentCollapsible
      names={names}
      stableKey={message.id}
      styles={styles}
      colors={colors}
    />
  );
};

export const ToolResultMessage: React.FC<{
  message: Message;
  styles: any;
  colors: any;
}> = ({ message, styles, colors }) => {
  const TaskToolDetail = useSlot(SLOTS.taskToolDetail);
  const toolIcon = getToolIcon(message.toolName);
  const toolLabel = getToolLabel(message.toolName, message.content);
  const durationLabel =
    message.generationTimeMs == null ? '' : ` (${message.generationTimeMs}ms)`;
  const isTaskTool = isTaskToolName(message.toolName);
  const taskDetail =
    isTaskTool && TaskToolDetail ? <TaskToolDetail message={message} /> : null;
  const hasDetails = isTaskTool
    ? Boolean(TaskToolDetail)
    : !!(
        message.content &&
        message.content.length > 0 &&
        !message.content.startsWith('No results')
      );
  // Prefer toolCallId (carried on every tool-result message and stable across the
  // streaming→finalized remount); fall back to the message id.
  const stableKey = message.toolCallId || message.id;
  // A tool result is its own message, so it carries the assistant column itself. Without this it sat
  // in a different column from the requested call it answers - one inset from the screen, the other
  // inset inside the 85% reply column - and a reader saw two indents instead of one list.
  return (
    <View style={styles.toolMessageRow}>
      <View style={styles.toolCallReplyContent}>
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
          detail={taskDetail}
        />
      </View>
    </View>
  );
};

export const SyncedToolArtifacts: React.FC<{
  message: Message;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
}> = ({ message, styles, colors }) => {
  const TaskToolDetail = useSlot(SLOTS.taskToolDetail);
  return (
    <>
      {message.toolArtifacts?.map((artifact, index) => {
        const running = artifact.status === 'running';
        const isTaskTool = isTaskToolName(artifact.name);
        const taskDetail =
          isTaskTool && TaskToolDetail ? (
            <TaskToolDetail
              message={{
                toolName: artifact.name,
                toolCallId: artifact.id,
                content: artifact.result,
              }}
            />
          ) : null;
        return (
          <ToolResultBubble
            key={`${artifact.name}:${index}`}
            stableKey={`${message.uuid ?? message.id}:${artifact.name}:${index}`}
            toolIcon={getToolIcon(artifact.name)}
            toolLabel={
              running
                ? `Using ${getToolLabel(artifact.name)}...`
                : getToolLabel(artifact.name, artifact.result)
            }
            toolName={artifact.name}
            durationLabel=""
            content={artifact.result}
            hasDetails={
              isTaskTool
                ? Boolean(TaskToolDetail)
                : !running && artifact.result.length > 0
            }
            active={running}
            styles={styles}
            colors={colors}
            detail={taskDetail}
          />
        );
      })}
    </>
  );
};

/**
 * The calls an assistant turn asked for, one row each.
 *
 * Each call is its own row through the shared component rather than N rows crammed into a single
 * container. Grouping them was what made four or five calls arrive as one dense block at 2px apart
 * while every finished result sat 16px from its neighbour - the same tool, two rhythms, in one
 * transcript.
 */
export const ToolCallMessage: React.FC<{
  message: Message;
  styles: any;
  colors: any;
}> = ({ message, styles, colors }) => (
  <View testID="tool-call-message">
    {message.toolCalls?.map((tc, i) => {
      let argsPreview = '';
      try {
        argsPreview = Object.values(JSON.parse(tc.arguments)).join(', ');
      } catch {
        argsPreview = tc.arguments;
      }
      const argsLabel = argsPreview ? `: ${argsPreview}` : '';
      return (
        <ToolResultBubble
          key={`${tc.id || i}`}
          stableKey={`${message.uuid ?? message.id}:call:${tc.id || i}`}
          toolIcon={getToolIcon(tc.name)}
          toolLabel={`Using ${tc.name}${argsLabel}`}
          toolName={tc.name}
          durationLabel=""
          content=""
          hasDetails={false}
          active
          paired
          rowTestID="tool-call-row"
          labelTestID={`tool-call-label-${tc.name || 'unknown'}`}
          styles={styles}
          colors={colors}
        />
      );
    })}
  </View>
);

export const SystemInfoMessage: React.FC<{
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
