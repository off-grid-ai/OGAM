/**
 * ProIncludedSection
 *
 * The features, as rows you can walk into.
 *
 * These rooms used to be what a licence unlocked; now they are simply what the app does, and the only
 * thing that can make one missing is a build without the optional pro bundle. Every row is gated on a
 * REGISTERED screen (`useHasRegisteredScreen`) rather than on any entitlement, so a build without a
 * surface never advertises it, there are no dead ends, and nothing is ever locked.
 */
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { useHasRegisteredScreen } from '../../navigation/screenRegistry';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';

interface IncludedRow {
  screen: string;
  icon: string;
  title: string;
  description: string;
}

const ROWS: IncludedRow[] = [
  {
    screen: 'Sync',
    icon: 'refresh-cw',
    title: 'Live sync across your devices',
    description: 'Your chats, projects, files, models and copied text stay current.',
  },
  {
    screen: 'Clipboard',
    icon: 'clipboard',
    title: 'Copy here, paste there',
    description: 'What you copy on one device is ready on the next one.',
  },
  {
    screen: 'McpServers',
    icon: 'terminal',
    title: 'Your own tools, in your chats',
    description: 'Point the model at your servers, files and APIs.',
  },
];

export const ProIncludedSection: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // Hooks cannot be called in a loop, so each row asks its own question.
  const registered: Record<string, boolean> = {
    Sync: useHasRegisteredScreen('Sync'),
    Clipboard: useHasRegisteredScreen('Clipboard'),
    McpServers: useHasRegisteredScreen('McpServers'),
  };
  const rows = ROWS.filter(row => registered[row.screen]);

  if (rows.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Included for everyone</Text>
      {rows.map((row, index) => (
        <TouchableOpacity
          key={row.screen}
          style={[styles.row, index === rows.length - 1 ? styles.lastRow : null]}
          activeOpacity={0.72}
          accessibilityRole="button"
          accessibilityLabel={row.title}
          onPress={() => navigation.navigate(row.screen)}
          testID={`pro-included-${row.screen}`}
        >
          <Icon name={row.icon} size={18} color={colors.primary} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{row.title}</Text>
            <Text style={styles.rowDescription}>{row.description}</Text>
          </View>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      ))}
    </View>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    marginHorizontal: SPACING.xl,
    marginBottom: SPACING.xl,
    ...shadows.small,
  },
  cardTitle: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xs,
  },
  row: {
    minHeight: 44,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lastRow: { borderBottomWidth: 0 },
  rowText: { flex: 1, gap: SPACING.xs },
  rowTitle: { ...TYPOGRAPHY.body, color: colors.text },
  rowDescription: { ...TYPOGRAPHY.meta, color: colors.textSecondary },
});
