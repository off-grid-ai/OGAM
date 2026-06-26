import React from 'react';
import { View, Text } from 'react-native';
import { ThinkingIndicator } from '../../ThinkingIndicator';
import { MarkdownText } from '../../MarkdownText';
import { BlinkingCursor } from './BlinkingCursor';
import { ThinkingBlock } from './ThinkingBlock';
import type { ParsedContent } from '../types';

interface MessageContentProps {
  isUser: boolean;
  isThinking?: boolean;
  content: string;
  isStreaming?: boolean;
  parsedContent: ParsedContent;
  showThinking: boolean;
  onToggleThinking: () => void;
  styles: any;
}

export function MessageContent({
  isUser,
  isThinking,
  content,
  isStreaming,
  parsedContent,
  showThinking,
  onToggleThinking,
  styles,
}: Readonly<MessageContentProps>) {
  if (isThinking) {
    return (
      <View testID="thinking-indicator">
        <ThinkingIndicator text={content} />
      </View>
    );
  }

  // If no content yet but we have live reasoning tokens, show the thinking block so
  // reasoning streams incrementally rather than appearing all at once when content arrives.
  if (!content && isStreaming && parsedContent.thinking) {
    return (
      <View>
        <ThinkingBlock
          parsedContent={parsedContent}
          showThinking={showThinking}
          onToggle={onToggleThinking}
          styles={styles}
        />
        <View testID="streaming-thinking-hint" style={styles.streamingThinkingHint}>
          <ThinkingIndicator />
        </View>
      </View>
    );
  }

  if (!content) {
    if (isStreaming) {
      return (
        <Text testID="message-text" style={[styles.text, styles.assistantText]}>
          <BlinkingCursor />
        </Text>
      );
    }
    // No content but may have thinking — render ThinkingBlock alone (audio mode above-bubble use case)
    if (parsedContent.thinking) {
      return (
        <ThinkingBlock
          parsedContent={parsedContent}
          showThinking={showThinking}
          onToggle={onToggleThinking}
          styles={styles}
        />
      );
    }
    return null;
  }

  return (
    <View>
      {!!parsedContent.thinking && (
        <ThinkingBlock
          parsedContent={parsedContent}
          showThinking={showThinking}
          onToggle={onToggleThinking}
          styles={styles}
        />
      )}

      {(() => {
        if (parsedContent.response) {
          if (isUser) {
            return (
              <Text
                testID="message-text"
                style={[styles.text, styles.userText]}
                selectable
              >
                {parsedContent.response}
              </Text>
            );
          }
          return (
            <View testID="message-text">
              <MarkdownText>{parsedContent.response}</MarkdownText>
              {isStreaming && <BlinkingCursor />}
            </View>
          );
        }
        if (isStreaming && !parsedContent.isThinkingComplete) {
          return (
            <View testID="streaming-thinking-hint" style={styles.streamingThinkingHint}>
              <ThinkingIndicator />
            </View>
          );
        }
        if (isStreaming) {
          return (
            <Text testID="message-text" style={[styles.text, styles.assistantText]}>
              <BlinkingCursor />
            </Text>
          );
        }
        return null;
      })()}
    </View>
  );
}
