import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { createStyles } from './styles';

type TriggerRef = React.RefObject<React.ElementRef<typeof TouchableOpacity> | null>;

interface ComposerIconsRowProps {
  pillIconsExpandedWidth: number;
  attachTriggerRef: TriggerRef;
  onAttachPress: () => void;
  quickSettingsTriggerRef: TriggerRef;
  onQuickSettingsPress: () => void;
  disabled?: boolean;
}

/**
 * The +/settings icon cluster on the right of the composer pill. It stays visible while typing so
 * attachments and chat settings are always one tap away. Extracted from ChatInput so that render stays under the max-lines lint budget
 * (no behaviour change).
 */
export const ComposerIconsRow: React.FC<ComposerIconsRowProps> = ({
  pillIconsExpandedWidth, attachTriggerRef, onAttachPress,
  quickSettingsTriggerRef, onQuickSettingsPress, disabled,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.pillIcons, { width: pillIconsExpandedWidth }]}>
      <TouchableOpacity
        ref={attachTriggerRef}
        testID="attach-button"
        style={styles.pillIconButton}
        onPress={onAttachPress}
        disabled={disabled}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      >
        <Icon name="plus" size={20} color={disabled ? colors.textMuted : colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity
        ref={quickSettingsTriggerRef}
        testID="quick-settings-button"
        style={styles.pillIconButton}
        onPress={onQuickSettingsPress}
        disabled={disabled}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      >
        <View style={styles.iconWrapper}>
          <Icon name="settings" size={18} color={disabled ? colors.textMuted : colors.textSecondary} />
        </View>
      </TouchableOpacity>
    </View>
  );
};
