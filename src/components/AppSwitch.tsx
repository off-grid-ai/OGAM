import React from 'react';
import { Platform } from 'react-native';
import type { SwitchProps } from 'react-native';
import { Switch } from './Touchable';
import { useTheme } from '../theme';

/**
 * The app's one on/off switch. Off is a dim knob on a muted track; on is a dark knob on a full
 * emerald track (an emerald knob on half-emerald had little contrast). Disabled dims. Screens used to colour their own, and some drew a white knob that read as "on"
 * while the switch was off (Remote Servers in dark mode, device 2026-11-05).
 */
const DISABLED = { opacity: 0.4 };

export const AppSwitch: React.FC<Omit<SwitchProps, 'trackColor' | 'thumbColor' | 'ios_backgroundColor'>> = props => {
  const { colors } = useTheme();
  const on = !!props.value;
  return (
    <Switch
      {...props}
      // A disabled switch dims on every platform (Android kept full colour, so it looked usable).
      style={[props.style, props.disabled && DISABLED]}
      // iOS: the platform's white knob, with the TRACK saying on (emerald) or off (a visible grey).
      // The dark knob read as broken on every screen in four hand tests. Android keeps its own tinted
      // knob, which is how on and off read there.
      trackColor={{ false: Platform.OS === 'ios' ? colors.border : colors.surfaceLight, true: colors.primary }}
      thumbColor={Platform.OS === 'ios' ? '#FFFFFF' : on ? colors.onPrimary : colors.textMuted}
      ios_backgroundColor={colors.border}
    />
  );
};
