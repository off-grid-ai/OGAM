import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { createStyles } from './styles';

/**
 * Push-to-talk hint shown INLINE in the composer while holding to record (the WhatsApp pattern):
 * a recording dot on the left and "‹ Slide to cancel" centred. The mic sits to the right, outside
 * the pill, where the thumb is. Living in the composer (not as a floating pill over the mic) keeps
 * it always visible and never overlapping the mic (device 2026-07-15).
 */
export const RecordingHint: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.recordingRow} testID="recording-hint">
      <View style={styles.recordingDot} />
      <View style={styles.slideToCancel}>
        <Icon name="chevron-left" size={16} color={colors.textMuted} />
        <Text style={styles.slideToCancelText}>Slide to cancel</Text>
      </View>
    </View>
  );
};
