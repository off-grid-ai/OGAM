import React, { useState } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../../components/AppSheet';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import {
  useResidentRows,
  ejectResident,
  type ModelRowType,
} from './useResidentRows';
import logger from '../../utils/logger';

// Defined in useResidentRows (breaks the sheet<->hook import cycle); re-exported here so existing
// consumers (Home, Chat, ModelsSummaryRow) keep importing it from the sheet.
export type { ModelRowType };

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
  /** Rows whose active selection lives on a REMOTE server (gateway) — shown with a cloud marker,
   *  matching the chat header's remote indicator, so a remote model is never mistaken for local. */
  remote?: Partial<Record<ModelRowType, boolean>>;
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
  visible,
  onClose,
  onClosed,
  labels,
  remote,
  loadingState,
  isEjecting,
  hasActiveModel,
  onOpenRow,
  onEject,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // Residency projection from the owning service (what is ACTUALLY in RAM) — the sheet is the
  // residency surface: a RAM chip + per-row eject on resident rows (agreed design 2026-07-14).
  const { byRow: residentByRow, unassigned: unassignedResidents } =
    useResidentRows(visible);
  const [ejectingKey, setEjectingKey] = useState<string | null>(null);
  const ejectRow = (row: ModelRowType) => {
    const resident = residentByRow[row];
    if (!resident || ejectingKey) return;
    setEjectingKey(resident.key);
    logger.log(
      `[MODEL-SM] sheet eject → ${resident.type} (${resident.key}) ~${(
        resident.sizeMB / 1024
      ).toFixed(1)}GB`,
    );
    ejectResident(resident)
      .catch(err =>
        logger.log(`[MODEL-SM] sheet eject ${resident.key} failed:`, err),
      )
      .finally(() => setEjectingKey(null));
  };

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      title="MODELS"
      enableDynamicSizing
    >
      <View style={styles.content}>
        {ROWS.map(row => {
          const isLoading =
            loadingState.isLoading && loadingState.type === row.type;
          const value = labels[row.type];
          const isSet = value && value !== '—';
          const resident = residentByRow[row.type];
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
              {/* Fixed-width eject column right of the label so all four rows align; empty when not resident. */}
              <View style={styles.ejectSlot}>
                {resident &&
                  (ejectingKey === resident.key ? (
                    <ActivityIndicator size="small" color={colors.error} />
                  ) : (
                    <TouchableOpacity
                      testID={`models-row-${row.type}-eject`}
                      accessibilityLabel={`Eject ${row.label} model from memory`}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      onPress={() => ejectRow(row.type)}
                    >
                      <Icon
                        name="power"
                        size={14}
                        color={colors.error}
                        style={styles.ejectGlyph}
                      />
                    </TouchableOpacity>
                  ))}
              </View>
              <View style={styles.valueGroup}>
                {resident && (
                  <View
                    testID={`models-row-${row.type}-ram`}
                    style={styles.ramChip}
                  >
                    <Text style={styles.ramChipText}>{`${(
                      resident.sizeMB / 1024
                    ).toFixed(1)} GB`}</Text>
                  </View>
                )}
                <Text
                  style={[styles.value, isSet && styles.valueSet]}
                  numberOfLines={1}
                >
                  {isLoading ? 'Loading…' : value}
                </Text>
                {!!remote?.[row.type] && isSet && (
                  <Icon
                    name="cloud"
                    size={12}
                    color={colors.primary}
                    testID={`models-row-${row.type}-remote`}
                  />
                )}
              </View>
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Icon name="chevron-right" size={16} color={colors.textMuted} />
              )}
            </AnimatedPressable>
          );
        })}

        {unassignedResidents.map(resident => (
          <View
            key={resident.key}
            testID={`resident-item-${resident.type}`}
            style={styles.sidecarRow}
          >
            <Icon name="cpu" size={16} color={colors.textMuted} />
            <View style={styles.sidecarCopy}>
              <Text style={styles.label}>
                {resident.type === 'embedding' ? 'Embedding' : 'Classifier'}
              </Text>
              <Text style={styles.sidecarDetail}>In memory sidecar</Text>
            </View>
            <View
              testID={`resident-item-${resident.type}-ram`}
              style={styles.ramChip}
            >
              <Text style={styles.ramChipText}>{`${(
                resident.sizeMB / 1024
              ).toFixed(1)} GB`}</Text>
            </View>
            <TouchableOpacity
              testID={`resident-item-${resident.type}-eject`}
              accessibilityLabel={`Eject ${resident.type} model from memory`}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              disabled={!!ejectingKey}
              onPress={() => {
                if (ejectingKey) return;
                setEjectingKey(resident.key);
                ejectResident(resident)
                  .catch(err =>
                    logger.log(
                      `[MODEL-SM] sheet eject ${resident.key} failed:`,
                      err,
                    ),
                  )
                  .finally(() => setEjectingKey(null));
              }}
            >
              {ejectingKey === resident.key ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <Icon name="power" size={14} color={colors.error} />
              )}
            </TouchableOpacity>
          </View>
        ))}

        {hasActiveModel && (
          <AnimatedPressable
            style={styles.ejectButton}
            hapticType="impactMedium"
            disabled={isEjecting || loadingState.isLoading}
            onPress={onEject}
          >
            {isEjecting ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <Icon name="power" size={14} color={colors.error} />
            )}
            <Text style={styles.ejectText}>Eject All Models</Text>
          </AnimatedPressable>
        )}
      </View>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors) => ({
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    gap: SPACING.sm as number,
  },
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
  sidecarRow: {
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
  sidecarCopy: { flex: 1 },
  sidecarDetail: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  label: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
    width: 64,
  },
  // Fixed-width control column right of the label — all four rows align whether or not resident.
  ejectSlot: {
    width: 22,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  ejectGlyph: { opacity: 0.8 },
  ramChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: SPACING.xs,
    paddingVertical: 1,
  },
  ramChipText: { ...TYPOGRAPHY.label, color: colors.textMuted },
  // Right-aligned value cluster: the name (shrinks/ellipsizes) with the remote cloud hugging its
  // right edge at the minimum token gap (xs) — the marker reads as part of the name, not the row.
  valueGroup: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'flex-end' as const,
    gap: SPACING.xs,
  },
  value: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
    flexShrink: 1,
    textAlign: 'right' as const,
  },
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
