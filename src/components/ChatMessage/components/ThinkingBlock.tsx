import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MarkdownText } from '../../MarkdownText';
import { prepareMessageForSpeech } from '../../../utils/messageContent';
import type { ParsedContent } from '../types';

interface ThinkingBlockProps {
  parsedContent: ParsedContent;
  showThinking: boolean;
  onToggle: () => void;
  styles: any;
}

export function ThinkingBlock({
  parsedContent,
  showThinking,
  onToggle,
  styles,
}: Readonly<ThinkingBlockProps>) {
  return (
    <View testID="thinking-block" style={styles.thinkingBlock}>
      <TouchableOpacity
        testID="thinking-block-toggle"
        style={styles.thinkingHeader}
        onPress={onToggle}
      >
        <View style={styles.thinkingHeaderIconBox}>
          <Text style={styles.thinkingHeaderIconText}>
            {(() => {
              if (parsedContent.thinkingLabel?.includes('Enhanced')) return 'E';
              return parsedContent.isThinkingComplete ? 'T' : '...';
            })()}
          </Text>
        </View>
        <View style={styles.thinkingHeaderTextContainer}>
          <Text testID="thinking-block-title" style={styles.thinkingHeaderText}>
            {parsedContent.thinkingLabel ||
              (parsedContent.isThinkingComplete
                ? 'Thought process'
                : 'Thinking...')}
          </Text>
          {!showThinking && !!parsedContent.thinking && (
            <View
              testID="thinking-block-preview"
              style={styles.thinkingPreview}
            >
              {/* Plain text clamped to two lines, so the cut ends in an ellipsis instead of a
                  fixed-height box slicing through a word. */}
              <Text
                style={styles.thinkingPreviewText}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {prepareMessageForSpeech(parsedContent.thinking).replace(/\s+/g, ' ').trim()}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.thinkingToggle}>{showThinking ? '▼' : '▶'}</Text>
      </TouchableOpacity>
      {showThinking && parsedContent.thinking != null && (
        <View
          testID="thinking-block-content"
          style={styles.thinkingBlockContent}
        >
          <MarkdownText dimmed>{parsedContent.thinking}</MarkdownText>
        </View>
      )}
    </View>
  );
}
