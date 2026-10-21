import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { formatFileSize } from '@offgrid/models';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { AnimatedPressable } from '../AnimatedPressable';
import type { PickSlot } from '../../services/devicePicks';

/**
 * Fast, Balanced and Best for this phone, at the top of a models tab: three small cards side by
 * side with the app's card depth, so the picks take one short row and the list starts high.
 */
const PICK_LABELS: Record<PickSlot, string> = {
  fast: 'Fast',
  balanced: 'Balanced',
  best: 'Best',
};

export type PickState =
  | { kind: 'download'; onDownload: () => void }
  | { kind: 'downloading'; progress: number }
  | { kind: 'use'; onUse: () => void }
  | {
      kind: 'active';
      next?: { label: string; icon: string; onPress: () => void };
    };

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
      <View style={styles.row}>
        {items.map(item => <PickCard key={item.slot} item={item} />)}
      </View>
    </View>
  );
};

/** One pick: a small card with the app's card depth, side by side with the others, so the list
 *  below starts high. The action is the card's trailing icon. */
const PickCard: React.FC<{ item: PickItem }> = ({ item }) => {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { slot, state } = item;
  const tid = (suffix: string) => `pick-${slot}-${suffix}`;
  let action: React.ReactNode;
  if (state.kind === 'download') {
    action = <IconAction icon="download" label={`Download ${item.name}`} onPress={state.onDownload} testID={tid('download')} />;
  } else if (state.kind === 'downloading') {
    action = <Text style={styles.progress} testID={tid('progress')}>{`${Math.round(state.progress * 100)}%`}</Text>;
  } else if (state.kind === 'use') {
    action = <IconAction icon="circle" label={`Use ${item.name}`} onPress={state.onUse} testID={tid('select')} />;
  } else if (state.next) {
    action = <IconAction icon={state.next.icon} label={state.next.label} onPress={state.next.onPress} testID={tid('next')} />;
  } else {
    action = <Icon name="check-circle" size={16} color={colors.primary} accessibilityLabel="In use" testID={tid('active')} />;
  }
  return (
    <View style={[styles.card, state.kind === 'active' && styles.cardActive]} testID={`pick-${slot}`}>
      <View style={styles.cardTop}>
        <Text style={styles.slot}>{PICK_LABELS[slot]}</Text>
        {action}
      </View>
      <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
      <Text style={styles.size}>{formatFileSize(item.sizeBytes)}</Text>
    </View>
  );
};

const IconAction: React.FC<{ icon: string; label: string; onPress: () => void; testID: string }> = ({ icon, label, onPress, testID }) => {
  const { colors } = useTheme();
  return (
    <AnimatedPressable onPress={onPress} accessibilityLabel={label} accessibilityRole="button" hitSlop={10} testID={testID}>
      <Icon name={icon} size={16} color={colors.primary} />
    </AnimatedPressable>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  section: { marginBottom: SPACING.md },
  sectionLabel: {
    ...TYPOGRAPHY.label, textTransform: 'uppercase' as const, color: colors.textMuted,
    letterSpacing: 0.3, marginBottom: SPACING.sm,
  },
  row: { flexDirection: 'row' as const, gap: SPACING.sm },
  // The same depth as the app's compact model cards.
  card: {
    flex: 1, backgroundColor: colors.surface, borderRadius: SPACING.sm, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm,
    ...shadows.small,
  },
  cardActive: { borderWidth: 2, borderColor: colors.primary },
  cardTop: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: SPACING.xs },
  slot: { ...TYPOGRAPHY.labelSmall, textTransform: 'uppercase' as const, color: colors.textMuted, letterSpacing: 0.3 },
  name: { ...TYPOGRAPHY.bodySmall, color: colors.text, minHeight: 34 },
  size: { ...TYPOGRAPHY.metaSmall, color: colors.textMuted, marginTop: 2 },
  progress: { ...TYPOGRAPHY.meta, color: colors.textSecondary },
});
