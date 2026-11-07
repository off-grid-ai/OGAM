import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { TouchableOpacity } from '../../Touchable';
import { MarkdownText } from '../../MarkdownText';
import { useTheme } from '../../../theme';
import type { ParsedContent } from '../types';

interface ThinkingBlockProps {
  parsedContent: ParsedContent;
  showThinking: boolean;
  onToggle: () => void;
  styles: any;
}

/**
 * The model's reasoning as one step in the turn's work, the way Desktop's timeline draws it: a quiet
 * row, "Thinking" with a spinner while live, "Thought" once done, and a chevron that opens the
 * reasoning. No card, no icon box (Mac, 2026-11-07: thinking in a card did not match Desktop).
 */
export function ThinkingBlock({
  parsedContent,
  showThinking,
  onToggle,
  styles,
}: Readonly<ThinkingBlockProps>) {
  const { colors } = useTheme();
  const live = !parsedContent.isThinkingComplete;
  // It sits inside the turn's Working / Work done row, so it names the step itself, as Desktop's
  // timeline does: "Thinking" while live, "Thought" once done.
  const title = parsedContent.thinkingLabel || (live ? 'Thinking' : 'Thought');
  return (
    <View testID="thinking-block" style={styles.thinkingBlock}>
      <TouchableOpacity
        testID="thinking-block-toggle"
        style={styles.thinkingHeader}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: showThinking, busy: live }}
        accessibilityHint={showThinking ? 'Hides the reasoning' : 'Shows the reasoning'}
      >
        {live ? <ActivityIndicator size="small" color={colors.primary} style={styles.thinkingSpinner} /> : null}
        <Text testID="thinking-block-title" style={styles.thinkingHeaderText}>
          {title}
        </Text>
        <Icon name={showThinking ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
      </TouchableOpacity>
      {showThinking && parsedContent.thinking != null && (
        <View testID="thinking-block-content" style={styles.thinkingBlockContent}>
          <MarkdownText dimmed>{parsedContent.thinking}</MarkdownText>
        </View>
      )}
    </View>
  );
}
