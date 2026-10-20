import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { AnimatedPressable } from '../AnimatedPressable';
import { ModelCard } from '../ModelCard';
import type { PickSlot } from '../../services/devicePicks';

/**
 * Fast, Balanced and Best for this phone, at the top of a models tab, drawn with the app's own
 * compact model card so the picks read exactly like every other model on the screen. One label
 * for the group; the card's own actions (download, progress, select, in use) do the rest.
 */
export const PICK_LABELS: Record<PickSlot, string> = {
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

export const PicksRow: React.FC<{ items: PickItem[]; testID?: string }> = ({
  items,
  testID = 'device-picks',
}) => {
  const styles = useThemedStyles(createStyles);
  if (items.length === 0) return null;
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionLabel}>For this phone</Text>
      {items.map(item => (
        <PickCard key={item.slot} item={item} />
      ))}
    </View>
  );
};

const PickCard: React.FC<{ item: PickItem }> = ({ item }) => {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { slot, state } = item;
  const next = state.kind === 'active' ? state.next : undefined;
  return (
    <ModelCard
      compact
      model={{ id: `pick-${slot}`, name: item.name, author: '' }}
      file={{
        name: item.name,
        size: item.sizeBytes,
        quantization: 'Unknown',
        downloadUrl: '',
      }}
      facts={[PICK_LABELS[slot]]}
      isDownloaded={state.kind === 'use' || state.kind === 'active'}
      isActive={state.kind === 'active'}
      isDownloading={state.kind === 'downloading'}
      downloadProgress={
        state.kind === 'downloading' ? state.progress : undefined
      }
      onDownload={state.kind === 'download' ? state.onDownload : undefined}
      onSelect={state.kind === 'use' ? state.onUse : undefined}
      testID={`pick-${slot}`}
      trailing={
        next ? (
          <AnimatedPressable
            style={styles.next}
            onPress={next.onPress}
            accessibilityLabel={next.label}
            accessibilityRole="button"
            hitSlop={8}
            testID={`pick-${slot}-next`}
          >
            <Icon name={next.icon} size={18} color={colors.primary} />
          </AnimatedPressable>
        ) : undefined
      }
    />
  );
};

const createStyles = (colors: ThemeColors) => ({
  section: { marginBottom: SPACING.sm },
  sectionLabel: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
    letterSpacing: 0.3,
    marginBottom: SPACING.sm,
  },
  next: { padding: SPACING.xs },
});
