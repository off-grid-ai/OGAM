import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import type { ChatQueueHold } from '@offgrid/sync';
import { useThemedStyles } from '../../theme';
import { createStyles } from './styles';

/** The messages waiting behind the running reply in this chat, and why they wait, if held. */
export interface QueueView {
  items: { id: string; text: string; now?: boolean }[];
  hold?: ChatQueueHold;
}

export interface QueueActions {
  /** Stop the running reply and send this message on its own. */
  onSendNow: (id: string) => void;
  onRemove: (id: string) => void;
  /** Send what is held, after a Stop or a failed reply. */
  onResume: () => void;
  onClear: () => void;
}

interface QueueRowProps {
  queue?: QueueView;
  actions?: QueueActions;
}

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

const HOLD_LABEL: Record<NonNullable<ChatQueueHold>, string> = {
  stop: 'Paused after Stop',
  failure: 'Paused after an error',
};

/**
 * Messages written while a reply runs, above the composer. Each can go now (the reply stops and it
 * is sent on its own) or be removed. What is left goes together when the reply ends.
 */
export const QueueRow: React.FC<QueueRowProps> = ({ queue, actions }) => {
  const styles = useThemedStyles(createStyles);
  const items = queue?.items ?? [];
  if (items.length === 0) return null;
  const held = queue?.hold && !items.some(item => item.now) ? queue.hold : undefined;
  return (
    <Animated.View
      testID="queue-indicator"
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      layout={LinearTransition.duration(200)}
      style={styles.queueList}
    >
      <View style={styles.queueRow}>
        <View style={styles.queueBadge}>
          <Text style={styles.queueBadgeText}>{items.length} queued</Text>
          {held ? <Text style={styles.queuePreview}>{HOLD_LABEL[held]}</Text> : null}
        </View>
        {held ? (
          <TouchableOpacity
            testID="queue-resume-button"
            accessibilityRole="button"
            accessibilityLabel="Send queued messages"
            style={styles.queueResumeButton}
            onPress={actions?.onResume}
            hitSlop={HIT_SLOP}
          >
            <Text style={styles.queueResumeText}>Send</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          testID="clear-queue-button"
          accessibilityRole="button"
          accessibilityLabel="Clear queued messages"
          style={styles.queueClearButton}
          onPress={actions?.onClear}
          hitSlop={HIT_SLOP}
        >
          <Icon name="x" size={14} />
        </TouchableOpacity>
      </View>
      {items.map((item, index) => (
        <Animated.View
          key={item.id}
          testID={`queued-message-${index}`}
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          layout={LinearTransition.duration(200)}
          style={styles.queueItem}
        >
          <Text style={styles.queueItemText} numberOfLines={1}>
            {item.text}
          </Text>
          <TouchableOpacity
            testID={`queued-send-now-${index}`}
            accessibilityRole="button"
            accessibilityLabel="Send queued message now"
            style={styles.queueClearButton}
            onPress={() => actions?.onSendNow(item.id)}
            hitSlop={HIT_SLOP}
          >
            <Icon name="corner-down-left" size={14} />
          </TouchableOpacity>
          <TouchableOpacity
            testID={`queued-remove-${index}`}
            accessibilityRole="button"
            accessibilityLabel="Remove from queue"
            style={styles.queueClearButton}
            onPress={() => actions?.onRemove(item.id)}
            hitSlop={HIT_SLOP}
          >
            <Icon name="trash-2" size={14} />
          </TouchableOpacity>
        </Animated.View>
      ))}
    </Animated.View>
  );
};
