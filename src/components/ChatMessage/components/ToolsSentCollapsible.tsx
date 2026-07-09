import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useAccordionExpanded } from '../../../stores';

interface ToolsSentCollapsibleProps {
  /** Tool names sent to the model for this turn (built-in + routed MCP/ext). */
  names: string[];
  /**
   * Stable identity for persisting this accordion's expanded state across the
   * streaming→finalized remount (the message id is NOT stable — it changes from
   * 'streaming' to the real id on finalize). Falls back to a content fingerprint
   * of the tool names if the caller can't supply one.
   */
  stableKey?: string;
  /** ChatMessage styles (systemInfoContainer / toolStatusRow / toolStatusText /
   *  toolDetailContainer) — passed in so text and audio modes share one look. */
  styles: any;
  colors: any;
}

/**
 * Collapsible list of every tool that was sent to the model for this turn (the routed
 * set), shown below the response so it's clear what the model could choose from.
 * Shared by the text chat bubble and the audio-mode bubble.
 */
const ToolsSentCollapsibleInner: React.FC<ToolsSentCollapsibleProps> = ({ names, stableKey, styles, colors }) => {
  const key = `tools-sent:${stableKey ?? names.join(',')}`;
  const [expanded, toggle] = useAccordionExpanded(key);
  if (!names?.length) return null;
  return (
    <View testID="tools-sent-collapsible" style={styles.systemInfoContainer}>
      <TouchableOpacity style={styles.toolStatusRow} onPress={toggle} activeOpacity={0.6}>
        <Icon name="tool" size={13} color={colors.textMuted} />
        <Text style={styles.toolStatusText} numberOfLines={1}>
          Tools sent in request ({names.length})
        </Text>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.textMuted} />
      </TouchableOpacity>
      {expanded && (
        <View style={styles.toolDetailContainer}>
          {names.map(name => (
            <Text key={name} style={styles.toolStatusText}>{`• ${name}`}</Text>
          ))}
        </View>
      )}
    </View>
  );
};

/**
 * Memoized: while a sibling message streams, the chat subtree re-renders every token.
 * The `names` array + styles/colors are stable for a finalized message, so the row
 * skips those churn renders — keeping the TouchableOpacity press target intact so a tap
 * during streaming registers (bug #37). Its expanded flag lives in accordionStore, so a
 * legitimate toggle still re-renders it.
 */
export const ToolsSentCollapsible = React.memo(ToolsSentCollapsibleInner);
