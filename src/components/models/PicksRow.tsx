import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { formatFileSize } from '@offgrid/models';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { AnimatedPressable } from '../AnimatedPressable';
import type { PickSlot } from '../../services/devicePicks';

/**
 * Fast, Balanced and Best for this phone, at the top of a models tab: thin rows in one surface,
 * divided by hairlines, each with one trailing icon action. The same section for every kind of
 * model (chat, image, speech); each tab only says what its picks are and what a tap does. The
 * active pick is marked by an emerald edge, not a bigger box.
 */
export const PICK_LABELS: Record<PickSlot, string> = { fast: 'Fast', balanced: 'Balanced', best: 'Best' };

export type PickState =
  | { kind: 'download'; onDownload: () => void }
  | { kind: 'downloading'; progress: number }
  | { kind: 'use'; onUse: () => void }
  | { kind: 'active'; next?: { label: string; icon: string; onPress: () => void } };

export interface PickItem {
  slot: PickSlot;
  name: string;
  sizeBytes: number;
  state: PickState;
}

export const PicksRow: React.FC<{ items: PickItem[]; testID?: string }> = ({ items, testID = 'device-picks' }) => {
  const styles = useThemedStyles(createStyles);
  if (items.length === 0) return null;
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionLabel}>For this phone</Text>
      <View style={styles.surface}>
        {items.map((item, index) => <PickRow key={item.slot} item={item} first={index === 0} />)}
      </View>
    </View>
  );
};

const IconAction: React.FC<{ icon: string; label: string; onPress: () => void; testID: string; filled?: boolean }> = ({ icon, label, onPress, testID, filled }) => {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  return (
    <AnimatedPressable
      style={[styles.iconButton, filled && styles.iconButtonFilled]}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      testID={testID}
    >
      <Icon name={icon} size={16} color={filled ? colors.background : colors.primary} />
    </AnimatedPressable>
  );
};

const PickRow: React.FC<{ item: PickItem; first: boolean }> = ({ item, first }) => {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { slot, state } = item;
  let action: React.ReactNode;
  if (state.kind === 'download') {
    action = <IconAction icon="download" label={`Download ${item.name}`} onPress={state.onDownload} testID={`pick-${slot}-download`} />;
  } else if (state.kind === 'downloading') {
    action = <Text style={styles.progress} testID={`pick-${slot}-progress`}>{`${Math.round(state.progress * 100)}%`}</Text>;
  } else if (state.kind === 'use') {
    action = <IconAction icon="circle" label={`Use ${item.name}`} onPress={state.onUse} testID={`pick-${slot}-use`} />;
  } else if (state.next) {
    action = <IconAction icon={state.next.icon} label={state.next.label} onPress={state.next.onPress} testID={`pick-${slot}-next`} filled />;
  } else {
    action = <Icon name="check-circle" size={16} color={colors.primary} accessibilityLabel="In use" testID={`pick-${slot}-active`} />;
  }
  return (
    <View style={[styles.row, !first && styles.rowDivider, state.kind === 'active' && styles.rowActive]} testID={`pick-${slot}`}>
      <Text style={styles.slot}>{PICK_LABELS[slot]}</Text>
      <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
      <Text style={styles.size}>{formatFileSize(item.sizeBytes)}</Text>
      <View style={styles.action}>{action}</View>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  section: { marginHorizontal: SPACING.md, marginBottom: SPACING.lg },
  sectionLabel: {
    ...TYPOGRAPHY.label, textTransform: 'uppercase' as const, color: colors.textMuted,
    letterSpacing: 0.3, marginBottom: SPACING.sm,
  },
  surface: {
    borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    backgroundColor: colors.surface, overflow: 'hidden' as const,
  },
  row: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
    borderLeftWidth: 2, borderLeftColor: 'transparent',
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowActive: { borderLeftColor: colors.primary },
  slot: { ...TYPOGRAPHY.label, textTransform: 'uppercase' as const, color: colors.textMuted, width: 64 },
  name: { ...TYPOGRAPHY.body, color: colors.text, flex: 1 },
  size: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  action: { width: 32, alignItems: 'flex-end' as const },
  iconButton: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  iconButtonFilled: { backgroundColor: colors.primary },
  progress: { ...TYPOGRAPHY.meta, color: colors.textSecondary },
});
