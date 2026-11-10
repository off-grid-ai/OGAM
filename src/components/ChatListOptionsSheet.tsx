import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from './AppSheet';
import { ListGroup, listRowStyle } from './ListGroup';
import { TouchableOpacity } from './Touchable';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import {
  DEFAULT_CHAT_GROUP_BY,
  DEFAULT_CHAT_SORT_BY,
  type ChatGroupBy,
  type ChatSortBy,
} from '../utils/chatGrouping';

const GROUPS: { value: ChatGroupBy; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'project', label: 'Project' },
  { value: 'none', label: 'None' },
];
const SORTS: { value: ChatSortBy; label: string }[] = [
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Created' },
];

/**
 * The Chats list's view menu, like Claude's: group by date, project or nothing, order by last update
 * or by when a chat was started, and go back to the defaults. A choice ticks at once; while the list
 * regroups (`working`) the chosen row shows a spinner, then its tick (design doc principle 10).
 */
export const ChatListOptionsSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  groupBy: ChatGroupBy;
  sortBy: ChatSortBy;
  onChange: (next: { groupBy: ChatGroupBy; sortBy: ChatSortBy }) => void;
  /** The list is still regrouping for the current choice. */
  working?: boolean;
}> = ({ visible, onClose, groupBy, sortBy, onChange, working = false }) => {
  const styles = useThemedStyles(createStyles);
  // Only the choice you touched shows it is working; the other keeps its tick.
  const [touched, setTouched] = useState<'group' | 'sort' | null>(null);
  const isDefault = groupBy === DEFAULT_CHAT_GROUP_BY && sortBy === DEFAULT_CHAT_SORT_BY;
  return (
    <AppSheet sheet="chat-list-options" visible={visible} onClose={onClose} enableDynamicSizing title="View">
      <View style={styles.body}>
        <Text style={styles.label}>Group by</Text>
        <ListGroup testID="chats-group-by">
          {GROUPS.map(option => (
            <Choice key={option.value} label={option.label} selected={groupBy === option.value} working={working && touched !== 'sort'}
              onPress={() => { setTouched('group'); onChange({ groupBy: option.value, sortBy }); }} testID={`chats-group-${option.value}`} />
          ))}
        </ListGroup>
        <Text style={styles.label}>Sort by</Text>
        <ListGroup testID="chats-sort-by">
          {SORTS.map(option => (
            <Choice key={option.value} label={option.label} selected={sortBy === option.value} working={working && touched !== 'group'}
              onPress={() => { setTouched('sort'); onChange({ groupBy, sortBy: option.value }); }} testID={`chats-sort-${option.value}`} />
          ))}
        </ListGroup>
        <TouchableOpacity
          style={styles.reset}
          disabled={isDefault}
          onPress={() => onChange({ groupBy: DEFAULT_CHAT_GROUP_BY, sortBy: DEFAULT_CHAT_SORT_BY })}
          accessibilityRole="button"
          accessibilityState={{ disabled: isDefault }}
          testID="chats-view-reset"
        >
          <Text style={[styles.resetText, isDefault && styles.resetDisabled]}>Reset to defaults</Text>
        </TouchableOpacity>
      </View>
    </AppSheet>
  );
};

const Choice: React.FC<{ label: string; selected: boolean; working: boolean; onPress: () => void; testID: string }> = ({
  label, selected, working, onPress, testID,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, busy: selected && working }}
      accessibilityLabel={label}
      testID={testID}
    >
      <Text style={styles.rowText}>{label}</Text>
      {selected && working ? <ActivityIndicator size="small" color={colors.textMuted} testID={`${testID}-working`} /> : null}
      {selected && !working ? <Icon name="check" size={16} color={colors.primary} /> : null}
    </TouchableOpacity>
  );
};

const createStyles = (colors: ThemeColors) => ({
  body: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl, gap: SPACING.sm },
  label: { ...TYPOGRAPHY.label, color: colors.textMuted, marginTop: SPACING.sm },
  row: { ...listRowStyle, justifyContent: 'space-between' as const },
  rowText: { ...TYPOGRAPHY.body, color: colors.text },
  reset: { alignSelf: 'center' as const, paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg },
  resetText: { ...TYPOGRAPHY.body, color: colors.primary },
  resetDisabled: { color: colors.textMuted },
});
