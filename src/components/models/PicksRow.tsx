import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { formatFileSize } from '@offgrid/models';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { AnimatedPressable } from '../AnimatedPressable';
import type { PickSlot } from '../../services/devicePicks';

/**
 * Fast, Balanced and Best for this phone, side by side at the top of a models tab. The same row for
 * every kind of model (chat, image, speech); each tab only says what its picks are and what a tap
 * does. One tap downloads; a finished pick is the active one, with the tab's own next step.
 */
export const PICK_LABELS: Record<PickSlot, string> = { fast: 'Fast', balanced: 'Balanced', best: 'Best' };

export type PickState =
  | { kind: 'download'; onDownload: () => void }
  | { kind: 'downloading'; progress: number }
  | { kind: 'use'; onUse: () => void }
  | { kind: 'active'; next?: { label: string; onPress: () => void } };

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
    <View style={styles.row} testID={testID}>
      {items.map(item => <PickCard key={item.slot} item={item} />)}
    </View>
  );
};

const PickCard: React.FC<{ item: PickItem }> = ({ item }) => {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { slot, state } = item;
  let action: React.ReactNode = null;
  if (state.kind === 'download') {
    action = (
      <AnimatedPressable style={styles.iconButton} onPress={state.onDownload} accessibilityLabel={`Download ${item.name}`} testID={`pick-${slot}-download`}>
        <Icon name="download" size={16} color={colors.primary} />
      </AnimatedPressable>
    );
  } else if (state.kind === 'downloading') {
    action = <Text style={styles.progress} testID={`pick-${slot}-progress`}>{`${Math.round(state.progress * 100)}%`}</Text>;
  } else if (state.kind === 'use') {
    action = (
      <AnimatedPressable style={styles.secondary} onPress={state.onUse} testID={`pick-${slot}-use`}>
        <Text style={styles.secondaryText}>Use</Text>
      </AnimatedPressable>
    );
  } else if (state.next) {
    action = (
      <AnimatedPressable style={styles.primary} onPress={state.next.onPress} testID={`pick-${slot}-next`}>
        <Text style={styles.primaryText}>{state.next.label}</Text>
      </AnimatedPressable>
    );
  } else {
    action = <Icon name="check-circle" size={16} color={colors.primary} accessibilityLabel="In use" testID={`pick-${slot}-active`} />;
  }
  return (
    <View style={[styles.card, state.kind === 'active' && styles.cardActive]} testID={`pick-${slot}`}>
      <Text style={styles.slot}>{PICK_LABELS[slot]}</Text>
      <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
      <Text style={styles.size}>{formatFileSize(item.sizeBytes)}</Text>
      <View style={styles.actionRow}>{action}</View>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  row: { flexDirection: 'row' as const, gap: SPACING.sm, paddingHorizontal: SPACING.md, marginBottom: SPACING.md },
  card: {
    flex: 1, padding: SPACING.sm, borderRadius: 8, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  cardActive: { borderColor: colors.primary },
  slot: { ...TYPOGRAPHY.meta, color: colors.primary, marginBottom: SPACING.xs },
  name: { ...TYPOGRAPHY.bodySmall, color: colors.text, minHeight: 36 },
  size: { ...TYPOGRAPHY.meta, color: colors.textSecondary, marginTop: SPACING.xs },
  actionRow: { marginTop: SPACING.sm, alignItems: 'flex-start' as const },
  iconButton: { padding: SPACING.xs, borderRadius: 6, borderWidth: 1, borderColor: colors.primary },
  primary: { paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm, borderRadius: 6, backgroundColor: colors.primary },
  primaryText: { ...TYPOGRAPHY.meta, color: colors.background },
  secondary: { paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm, borderRadius: 6, borderWidth: 1, borderColor: colors.primary },
  secondaryText: { ...TYPOGRAPHY.meta, color: colors.primary },
  progress: { ...TYPOGRAPHY.meta, color: colors.textSecondary },
});
