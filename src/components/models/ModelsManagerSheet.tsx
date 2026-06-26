import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../../components/AppSheet';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';

export type ModelRowType = 'text' | 'image' | 'voice' | 'speech';

/** Minimal loading shape so this sheet is screen-agnostic (home + chat). */
type LoadingState = { isLoading: boolean; type?: string | null };

type RowDef = { type: ModelRowType; icon: string; label: string };

const ROWS: RowDef[] = [
  { type: 'text', icon: 'message-square', label: 'Text' },
  { type: 'image', icon: 'image', label: 'Image' },
  { type: 'voice', icon: 'volume-2', label: 'Voice' },
  { type: 'speech', icon: 'mic', label: 'Speech' },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Fired once the sheet has fully closed — used to open a picker safely after. */
  onClosed?: () => void;
  labels: Record<ModelRowType, string>;
  loadingState: LoadingState;
  isEjecting: boolean;
  hasActiveModel: boolean;
  onOpenRow: (type: ModelRowType) => void;
  onEject: () => void;
};

/**
 * Bottom sheet that manages all four model types via progressive disclosure: a
 * compact row per type showing the current selection; tapping a row opens that
 * type's picker.
 */
export const ModelsManagerSheet: React.FC<Props> = ({
  visible, onClose, onClosed, labels, loadingState, isEjecting, hasActiveModel, onOpenRow, onEject,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <AppSheet visible={visible} onClose={onClose} onClosed={onClosed} title="MODELS" enableDynamicSizing>
      <View style={styles.content}>
        {ROWS.map((row) => {
          const isLoading = loadingState.isLoading && loadingState.type === row.type;
          const value = labels[row.type];
          const isSet = value && value !== '—';
          return (
            <AnimatedPressable
              key={row.type}
              style={styles.row}
              hapticType="selection"
              testID={`models-row-${row.type}`}
              onPress={() => onOpenRow(row.type)}
            >
              <Icon name={row.icon} size={16} color={colors.textMuted} />
              <Text style={styles.label}>{row.label}</Text>
              <Text style={[styles.value, isSet && styles.valueSet]} numberOfLines={1}>
                {isLoading ? 'Loading…' : value}
              </Text>
              {isLoading
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Icon name="chevron-right" size={16} color={colors.textMuted} />}
            </AnimatedPressable>
          );
        })}

        {hasActiveModel && (
          <AnimatedPressable
            style={styles.ejectButton}
            hapticType="impactMedium"
            disabled={isEjecting || loadingState.isLoading}
            onPress={onEject}
          >
            {isEjecting
              ? <ActivityIndicator size="small" color={colors.error} />
              : <Icon name="power" size={14} color={colors.error} />}
            <Text style={styles.ejectText}>Eject All Models</Text>
          </AnimatedPressable>
        )}
      </View>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors) => ({
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.xl, gap: SPACING.sm as number },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  label: { ...TYPOGRAPHY.label, textTransform: 'uppercase' as const, color: colors.textMuted, width: 64 },
  value: { ...TYPOGRAPHY.body, color: colors.textMuted, flex: 1, textAlign: 'right' as const },
  valueSet: { color: colors.text },
  ejectButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    marginTop: SPACING.sm,
  },
  ejectText: { ...TYPOGRAPHY.bodySmall, color: colors.error },
});
