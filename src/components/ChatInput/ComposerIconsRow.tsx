import React from 'react';
import { View, TouchableOpacity, Animated } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { createStyles } from './styles';

type TriggerRef = React.RefObject<React.ElementRef<typeof TouchableOpacity> | null>;

interface ComposerIconsRowProps {
  /** Collapses the icons to zero width once the user starts typing. */
  hasText: boolean;
  iconsAnim: Animated.Value;
  pillIconsExpandedWidth: number;
  attachTriggerRef: TriggerRef;
  onAttachPress: () => void;
  quickSettingsTriggerRef: TriggerRef;
  onQuickSettingsPress: () => void;
  showSettingsDot: boolean;
  disabled?: boolean;
}

/**
 * The +/settings icon cluster on the right of the composer pill, which animates to zero width as
 * the user types. Extracted from ChatInput so that render stays under the max-lines lint budget
 * (no behaviour change).
 */
export const ComposerIconsRow: React.FC<ComposerIconsRowProps> = ({
  hasText, iconsAnim, pillIconsExpandedWidth, attachTriggerRef, onAttachPress,
  quickSettingsTriggerRef, onQuickSettingsPress, showSettingsDot, disabled,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Animated.View
      pointerEvents={hasText ? 'none' : 'auto'}
      style={[styles.pillIcons, {
        width: iconsAnim.interpolate({ inputRange: [0, 1], outputRange: [pillIconsExpandedWidth, 0] }),
        opacity: iconsAnim.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' }),
        overflow: 'hidden' as const,
      }]}
    >
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
          {showSettingsDot && <View style={styles.toolWarningDot} />}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};
