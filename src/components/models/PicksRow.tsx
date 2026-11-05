import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { formatFileSize } from '@offgrid/models';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { AnimatedPressable } from '../AnimatedPressable';
import type { PickSlot } from '../../services/devicePicks';
import { ListGroup } from '../ListGroup';
import { MadeByOffGrid } from '../ModelCardContent';

/**
 * Fast, Balanced and Best for this phone, at the top of a models tab: three short rows on one surface
 * with hairlines (the list's own look), the kind on the left, the action on the right.
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
  /** Off Grid AI built these files: its mark sits beside the size, as on the model cards. */
  madeByOffGrid?: boolean;
}

export const PicksRow: React.FC<{ items: PickItem[]; testID?: string }> = ({ items, testID = 'device-picks' }) => {
  const styles = useThemedStyles(createStyles);
  if (items.length === 0) return null;
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionLabel}>For this phone</Text>
      <ListGroup>
        {items.map(item => <PickCard key={item.slot} item={item} />)}
      </ListGroup>
    </View>
  );
};

/** One pick: a row of the group; the action is the row's trailing icon. */
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
      <Text style={styles.slot}>{PICK_LABELS[slot]}</Text>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        <View style={styles.meta}>
          {item.madeByOffGrid && <MadeByOffGrid />}
          <Text style={styles.size}>{formatFileSize(item.sizeBytes)}</Text>
        </View>
      </View>
      {action}
    </View>
  );
};

const IconAction: React.FC<{ icon: string; label: string; onPress: () => void; testID: string }> = ({ icon, label, onPress, testID }) => {
  const { colors } = useTheme();
  return (
    <AnimatedPressable onPress={onPress} accessibilityLabel={label} accessibilityRole="button" hitSlop={14} testID={testID}>
      <Icon name={icon} size={16} color={colors.textSecondary} />
    </AnimatedPressable>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  section: { marginBottom: SPACING.md },
  sectionLabel: {
    ...TYPOGRAPHY.label, textTransform: 'uppercase' as const, color: colors.textMuted,
    letterSpacing: 0.3, marginBottom: SPACING.sm,
  },
  // A row of the group: the kind, the model and its size, the action; about 52px tall.
  card: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, minHeight: 52,
  },
  cardActive: { backgroundColor: colors.selectedFill },
  slot: { ...TYPOGRAPHY.label, textTransform: 'uppercase' as const, color: colors.textMuted, letterSpacing: 0.3, width: 64 },
  body: { flex: 1 },
  name: { ...TYPOGRAPHY.body, color: colors.text },
  meta: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.xs, marginTop: 2 },
  size: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  progress: { ...TYPOGRAPHY.meta, color: colors.textSecondary },
});
