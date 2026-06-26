import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useThemedStyles } from '../../theme';
import { createStyles } from './styles';

interface QueueRowProps {
  queueCount: number;
  queuedTexts: string[];
  onClearQueue?: () => void;
}

export const QueueRow: React.FC<QueueRowProps> = ({ queueCount, queuedTexts, onClearQueue }) => {
  const styles = useThemedStyles(createStyles);
  if (queueCount === 0) return null;
  const preview = queuedTexts[0];
  return (
    <View testID="queue-indicator" style={styles.queueRow}>
      <View style={styles.queueBadge}>
        <Text style={styles.queueBadgeText}>{queueCount} queued</Text>
        {preview ? (
          <Text style={styles.queuePreview} numberOfLines={1}>
            {preview.length > 40 ? `${preview.substring(0, 40)}...` : preview}
          </Text>
        ) : null}
      </View>
      <TouchableOpacity
        testID="clear-queue-button"
        style={styles.queueClearButton}
        onPress={onClearQueue}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Icon name="x" size={14} />
      </TouchableOpacity>
    </View>
  );
};
