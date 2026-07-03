/**
 * RemoteToolsToggle
 *
 * Tappable "Tools" badge shown on remote model rows. Tool calling detection is
 * heuristic (name patterns, optional server metadata) and often wrong for
 * custom models, so the badge doubles as a manual knob: tapping it flips the
 * model's supportsToolCalling capability and persists the choice as an
 * override that survives re-discovery.
 */

import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { TYPOGRAPHY, SPACING } from '../constants';
import type { RemoteModel } from '../types';

interface RemoteToolsToggleProps {
  model: RemoteModel;
}

const HIT_SLOP = { top: SPACING.sm, bottom: SPACING.sm, left: SPACING.sm, right: SPACING.sm };

export const RemoteToolsToggle: React.FC<RemoteToolsToggleProps> = ({ model }) => {
  const { colors } = useTheme();
  const setToolCallingOverride = useRemoteServerStore((s) => s.setToolCallingOverride);
  const enabled = model.capabilities.supportsToolCalling;
  const color = enabled ? colors.warning : colors.textMuted;

  // Read the current value from the store at press time: a fast double-tap can
  // fire twice before the re-render updates the `model` prop, and both presses
  // would otherwise write the same stale flip instead of cancelling out.
  const handlePress = () => {
    const state = useRemoteServerStore.getState();
    const current =
      state.getModelById(model.serverId, model.id)?.capabilities.supportsToolCalling
      ?? model.capabilities.supportsToolCalling;
    setToolCallingOverride(model.serverId, model.id, !current);
  };

  return (
    <TouchableOpacity
      style={[styles.badge, { backgroundColor: enabled ? `${colors.warning}20` : colors.surfaceLight }]}
      onPress={handlePress}
      hitSlop={HIT_SLOP}
      accessibilityRole="switch"
      accessibilityState={{ checked: enabled }}
      accessibilityLabel={`Tool calling ${enabled ? 'enabled' : 'disabled'} for ${model.name}`}
      testID={`tools-toggle-${model.id}`}
    >
      <Icon name="tool" size={10} color={color} />
      <Text style={[styles.badgeText, { color }]}>{enabled ? 'Tools' : 'No tools'}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: SPACING.xs,
  },
  badgeText: {
    ...TYPOGRAPHY.meta,
  },
});
