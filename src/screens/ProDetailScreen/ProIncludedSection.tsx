/**
 * ProIncludedSection
 *
 * What an active licence actually gets you, as rows you can walk into.
 *
 * The Pro screen used to end after the licence card, leaving most of the page empty for anyone who
 * had already paid - and empty space that says nothing is a bug, not a layout. A subscriber does not
 * need the sales pitch again; they need the doors it opened.
 *
 * Every row is gated on a REGISTERED screen (`useHasRegisteredScreen`), so a build without a surface
 * never advertises it and there are no dead ends.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { TouchableOpacity } from '../../components/Touchable';
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
      <Text style={styles.cardTitle}>Included with Pro</Text>
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
