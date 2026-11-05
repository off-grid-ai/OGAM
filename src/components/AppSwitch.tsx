import React from 'react';
import type { SwitchProps } from 'react-native';
import { Switch } from './Touchable';
import { useTheme } from '../theme';

/**
 * The app's one on/off switch. Off is a dim knob on a muted track; on is an emerald knob on a soft
 * emerald track. Screens used to colour their own, and some drew a white knob that read as "on"
 * while the switch was off (Remote Servers in dark mode, device 2026-11-05).
 */
export const AppSwitch: React.FC<Omit<SwitchProps, 'trackColor' | 'thumbColor' | 'ios_backgroundColor'>> = props => {
  const { colors } = useTheme();
  const on = !!props.value;
  return (
    <Switch
      {...props}
      trackColor={{ false: colors.surfaceLight, true: `${colors.primary}80` }}
      thumbColor={on ? colors.primary : colors.textMuted}
      ios_backgroundColor={colors.surfaceLight}
    />
  );
};
