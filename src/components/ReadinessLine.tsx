import { t } from '@offgrid/i18n';
import React from 'react';
import { View, Text, type StyleProp, type ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type { Readiness, ReadinessAction } from '@offgrid/features';
import { Button } from './Button';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

/**
 * Why a feature cannot run right now, in one line, with its one next step (two when a computer is
 * offline: try again, or get a model here). The words and the step come from the shared readiness
 * rule (@offgrid/features), so every screen and every app says the same thing.
 */
export const ReadinessLine: React.FC<{
  readiness: Readiness;
  onAction: (action: ReadinessAction) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}> = ({ readiness, onAction, style, testID = 'readiness-line' }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  if (readiness.ready) return null;
  const actions = [readiness.action, readiness.also].filter((a): a is ReadinessAction => !!a);
  return (
    <View style={[styles.row, style]} testID={testID} accessibilityRole="alert">
      <Icon name="alert-circle" size={14} color={colors.textSecondary} style={styles.icon} />
      <Text style={styles.line}>
        <Text>{t(readiness.line, ...readiness.lineArgs)}</Text>
        {actions.map(action => (
          <Text
            key={action.kind}
            style={styles.action}
            onPress={() => onAction(action)}
            accessibilityRole="button"
            testID={`${testID}-${action.kind}`}
          >
            {'  '}
            {t(action.label)}
          </Text>
        ))}
      </Text>
    </View>
  );
};

/** A readiness line as a full-width card, for an empty screen that has nothing else to show. */
export const ReadinessCard: React.FC<{
  readiness: Readiness;
  onAction: (action: ReadinessAction) => void;
  testID?: string;
}> = ({ readiness, onAction, testID = 'readiness-card' }) => {
  const styles = useThemedStyles(createStyles);
  if (readiness.ready) return null;
  const actions = [readiness.action, readiness.also].filter((a): a is ReadinessAction => !!a);
  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.cardLine}>{t(readiness.line, ...readiness.lineArgs)}</Text>
      <View style={styles.cardActions}>
        {actions.map((action, index) => (
          <Button
            key={action.kind}
            title={t(action.label)}
            variant={index === 0 ? 'hero' : 'outline'}
            size="small"
            onPress={() => onAction(action)}
            testID={`${testID}-${action.kind}`}
          />
        ))}
      </View>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  icon: { marginTop: 2 },
  line: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  action: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.primary,
  },
  card: {
    alignItems: 'center' as const,
    gap: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
  cardLine: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
  },
  cardActions: {
    flexDirection: 'row' as const,
    gap: SPACING.sm,
  },
});
