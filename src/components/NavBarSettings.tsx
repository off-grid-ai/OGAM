/** Settings > Appearance: choose which destinations the bottom bar shows, and in what order. */
import React from 'react';
import { Switch, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore } from '../stores';
import {
  LOCKED, MAX_VISIBLE, MIN_VISIBLE, moveNavItem, navItem, resolveNavBar, setNavItemVisible,
} from '../utils/navBar';

export const NavBarSettings: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navBar = useAppStore(s => s.settings?.navBar);
  const updateSettings = useAppStore(s => s.updateSettings);
  const { order, visible, labels } = resolveNavBar(navBar);
  const full = visible.length >= MAX_VISIBLE;
  return (
    <View testID="navbar-settings">
      <Text style={styles.section}>Bottom bar</Text>
      <Text style={styles.note}>
        Pick up to {MAX_VISIBLE} destinations, at least {MIN_VISIBLE}. Settings always stays. Anything you turn off is still one tap away: Models from Home or Settings, the Atlas tools from Settings. Hold a tab for a shortcut: Home Search, Chats New chat, Workspace New project, Learn Practice call, Models Downloads, Settings Appearance.
      </Text>
      <View style={styles.list}>
        {order.map((id, index) => {
          const item = navItem(id);
          const on = visible.includes(id);
          const canToggle = id !== LOCKED && (on ? visible.length > MIN_VISIBLE : !full);
          return (
            <View key={id} style={[styles.row, index === order.length - 1 && styles.rowLast]} testID={`navbar-row-${id}`}>
              <Icon name={item.icon} size={18} color={on ? colors.primary : colors.textMuted} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{item.label}</Text>
                <Text style={styles.rowDesc}>{item.description}</Text>
              </View>
              <TouchableOpacity accessibilityLabel={`Move ${item.label} earlier`} disabled={index === 0} onPress={() => updateSettings({ navBar: moveNavItem(navBar, id, -1) })} style={styles.arrow}>
                <Icon name="chevron-up" size={18} color={index === 0 ? colors.border : colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity accessibilityLabel={`Move ${item.label} later`} disabled={index === order.length - 1} onPress={() => updateSettings({ navBar: moveNavItem(navBar, id, 1) })} style={styles.arrow}>
                <Icon name="chevron-down" size={18} color={index === order.length - 1 ? colors.border : colors.textSecondary} />
              </TouchableOpacity>
              <Switch testID={`navbar-switch-${id}`} accessibilityLabel={`Show ${item.label} in the bottom bar`} value={on} disabled={!canToggle}
                onValueChange={v => updateSettings({ navBar: setNavItemVisible(navBar, id, v) })}
                trackColor={{ false: colors.border, true: colors.primary }} />
            </View>
          );
        })}
      </View>
      <View style={styles.labelRow}>
        <Text style={styles.rowTitle}>Show labels under the icons</Text>
        <Switch testID="navbar-labels" accessibilityLabel="Show labels under the icons" value={labels}
          onValueChange={v => updateSettings({ navBar: { ...(navBar ?? {}), labels: v } })}
          trackColor={{ false: colors.border, true: colors.primary }} />
      </View>
      <TouchableOpacity testID="navbar-reset" accessibilityRole="button" onPress={() => updateSettings({ navBar: undefined })} style={styles.reset}>
        <Text style={styles.resetText}>Reset to the default bar</Text>
      </TouchableOpacity>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  section: { ...TYPOGRAPHY.h2, color: colors.text, marginTop: SPACING.lg, marginBottom: SPACING.xs },
  note: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, marginTop: SPACING.xs },
  list: { marginTop: SPACING.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm, padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLast: { borderBottomWidth: 0 },
  rowText: { flex: 1 },
  rowTitle: { ...TYPOGRAPHY.body, color: colors.text },
  rowDesc: { ...TYPOGRAPHY.metaSmall, color: colors.textMuted },
  arrow: { padding: SPACING.xs },
  labelRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginTop: SPACING.md },
  reset: { marginTop: SPACING.md, alignSelf: 'flex-start' as const },
  resetText: { ...TYPOGRAPHY.body, color: colors.primary },
});
