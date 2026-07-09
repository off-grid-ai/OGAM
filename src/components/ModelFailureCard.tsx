import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useThemedStyles } from '../theme/useThemedStyles';
import { useTheme } from '../theme';
import type { ThemeColors } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { AnimatedPressable } from './AnimatedPressable';
import {
  useModelFailureStore,
  type ModelFailure,
} from '../stores/modelFailureStore';

/**
 * ModelFailureCard — the SINGLE, dismissible surface for every model failure
 * (text / image / tts / stt / embedding). It is a thin read-only projection of
 * modelFailureStore: the store is the only writer (via reportModelFailure), this
 * is the only reader. Replaces the old flat chat-message / scattered-alert /
 * silent-swallow paths so failures look the same everywhere and can be dismissed.
 *
 * Severity drives the look only — 'error' (blocking) vs 'warning' (soft notice) —
 * never branches on a concrete modelType.
 *
 * Design system: brutalist/terminal per ../../brand/DESIGN_PHILOSOPHY.md +
 * docs/design/DESIGN_PHILOSOPHY_SYSTEM.md + docs/design/VISUAL_HIERARCHY_STANDARD.md.
 * All colour/spacing/type from tokens (COLORS/SPACING/TYPOGRAPHY), weights ≤400, and
 * actions use Feather vector icons only (never emoji) — see the actions row below.
 */
const ICON_FOR_SEVERITY = { error: 'alert-octagon', warning: 'alert-triangle' } as const;

/** One row action (Retry / Load Anyway) — a single shape both actions share so they
 *  never drift and a third action is a one-liner. `label` doubles as the a11y label. */
function ActionButton({ icon, color, label, testID, onPress, styles }: {
  icon: string; color: string; label: string; testID: string; onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}): React.ReactElement {
  return (
    <AnimatedPressable onPress={onPress} style={styles.actionButton} accessibilityLabel={label} testID={testID}>
      <Icon name={icon} size={12} color={color} style={styles.actionIcon} />
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </AnimatedPressable>
  );
}

function FailureRow({ failure, onDismiss }: { failure: ModelFailure; onDismiss: () => void }): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const tint = failure.severity === 'error' ? colors.error : colors.textSecondary;

  return (
    <View style={[styles.card, failure.severity === 'error' ? styles.cardError : styles.cardWarning]} testID={`model-failure-${failure.modelType}`}>
      <View style={styles.headerRow}>
        <Icon name={ICON_FOR_SEVERITY[failure.severity]} size={14} color={tint} style={styles.leadIcon} />
        <Text style={[styles.title, { color: tint }]} numberOfLines={2}>{failure.title}</Text>
        <AnimatedPressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Dismiss" testID={`model-failure-dismiss-${failure.modelType}`}>
          <Icon name="x" size={16} color={colors.textSecondary} />
        </AnimatedPressable>
      </View>
      <Text style={styles.message}>{failure.message}</Text>
      {(failure.onRetry || (failure.overridable && failure.onLoadAnyway)) && (
        <View style={styles.actionsRow}>
          {failure.onRetry && (
            <ActionButton
              icon="refresh-cw"
              color={colors.primary}
              label={failure.memoryPressure ? 'Free memory & Retry' : 'Retry'}
              testID={`model-failure-retry-${failure.modelType}`}
              onPress={() => { onDismiss(); failure.onRetry?.(); }}
              styles={styles}
            />
          )}
          {failure.overridable && failure.onLoadAnyway && (
            <ActionButton
              icon="zap"
              color={colors.error}
              label="Load Anyway"
              testID={`model-failure-load-anyway-${failure.modelType}`}
              onPress={() => { onDismiss(); failure.onLoadAnyway?.(); }}
              styles={styles}
            />
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Renders all active failure cards. Mount once near the chat composer — it reads
 * the store and shows nothing when there are no failures.
 */
export const ModelFailureCard: React.FC = () => {
  const failures = useModelFailureStore((s) => s.failures);
  const dismiss = useModelFailureStore((s) => s.dismiss);
  if (failures.length === 0) return null;
  return (
    <View>
      {failures.map((f) => (
        <FailureRow key={f.id} failure={f} onDismiss={() => dismiss(f.id)} />
      ))}
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  cardError: {
    backgroundColor: colors.errorBackground,
    borderColor: colors.error,
  },
  cardWarning: {
    backgroundColor: colors.surfaceLight,
    borderColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  leadIcon: {
    marginTop: 1,
  },
  title: {
    ...TYPOGRAPHY.h3,
    flex: 1,
  },
  message: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginTop: SPACING.xs,
  },
  actionsRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
    marginTop: SPACING.sm,
    gap: SPACING.lg,
  },
  actionButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: SPACING.xs,
  },
  actionIcon: {
    marginRight: SPACING.xs,
  },
  actionText: {
    ...TYPOGRAPHY.label,
    color: colors.primary,
  },
});
