import React from 'react';
import { ScrollView, View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../AppSheet';
import { useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import type { CatalogCheckResult } from '../../stores/modelCatalogStore';

/** What "check for new models" found: the new models by name, or that nothing changed. */
export const CatalogCheckSheet: React.FC<{ result: CatalogCheckResult | null; onClose: () => void }> = ({ result, onClose }) => {
  const styles = useThemedStyles(createStyles);
  const title = !result
    ? ''
    : result.status === 'new'
      ? `${result.names.length} new model${result.names.length === 1 ? '' : 's'}`
      : result.status === 'updated'
        ? 'Models updated'
        : result.status === 'none'
          ? 'Up to date'
          : "Couldn't check for new models";
  return (
    <AppSheet visible={result !== null} onClose={onClose} enableDynamicSizing title={title}>
      <ScrollView contentContainerStyle={styles.content} testID="catalog-check-sheet">
        {result?.status === 'new' && result.names.map(name => (
          <View key={name} style={styles.row}>
            <Icon name="plus-circle" size={18} color={styles.accent.color} />
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
          </View>
        ))}
        {result?.status === 'failed' && <Text style={styles.message}>Check your connection and try again.</Text>}
      </ScrollView>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  content: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xl,
    gap: SPACING.md,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  name: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    flexShrink: 1,
  },
  message: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  accent: {
    color: colors.primary,
  },
});
