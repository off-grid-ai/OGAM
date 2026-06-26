import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';

interface ToolsSentCollapsibleProps {
  /** Tool names sent to the model for this turn (built-in + routed MCP/ext). */
  names: string[];
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
export const ToolsSentCollapsible: React.FC<ToolsSentCollapsibleProps> = ({ names, styles, colors }) => {
  const [expanded, setExpanded] = useState(false);
  if (!names?.length) return null;
  return (
    <View testID="tools-sent-collapsible" style={styles.systemInfoContainer}>
      <TouchableOpacity style={styles.toolStatusRow} onPress={() => setExpanded(!expanded)} activeOpacity={0.6}>
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
