import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MarkdownText } from '../../MarkdownText';
import type { ParsedContent } from '../types';

interface ThinkingBlockProps {
  parsedContent: ParsedContent;
  isStreaming?: boolean;
  showThinking: boolean;
  onToggle: () => void;
  styles: any;
}

export function ThinkingBlock({
  parsedContent,
  isStreaming = false,
  showThinking,
  onToggle,
  styles,
}: Readonly<ThinkingBlockProps>) {
  const thinkingInProgress = isStreaming || !parsedContent.isThinkingComplete;
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
              return thinkingInProgress ? '...' : 'T';
            })()}
          </Text>
        </View>
        <View style={styles.thinkingHeaderTextContainer}>
          <Text testID="thinking-block-title" style={styles.thinkingHeaderText}>
            {parsedContent.thinkingLabel ||
              (thinkingInProgress ? 'Thinking...' : 'Thought process')}
          </Text>
          {!showThinking && !!parsedContent.thinking && (
            <View
              testID="thinking-block-preview"
              style={styles.thinkingPreview}
            >
              <MarkdownText dimmed compact>
                {parsedContent.thinking.length > 80
                  ? `${parsedContent.thinking.slice(0, 80)}...`
                  : parsedContent.thinking}
              </MarkdownText>
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
