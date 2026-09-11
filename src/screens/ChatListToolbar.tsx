import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { LoadingDots } from '../components/LoadingDots';
import { SPACING, TYPOGRAPHY } from '../constants';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';

interface ChatListToolbarProps {
  searchQuery: string;
  isSelecting: boolean;
  selectedCount: number;
  isDeleting: boolean;
  onSearchChange: (value: string) => void;
  onBulkDeleteAction: () => void;
}

export const ChatListToolbar: React.FC<ChatListToolbarProps> = ({
  searchQuery,
  isSelecting,
  selectedCount,
  isDeleting,
  onSearchChange,
  onBulkDeleteAction,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const actionLabel = isSelecting
    ? selectedCount === 0
      ? 'Done selecting chats'
      : `Delete ${selectedCount} selected ${
          selectedCount === 1 ? 'chat' : 'chats'
        }`
    : 'Select chats to delete';

  return (
    <View style={styles.toolbar}>
      <View style={styles.searchBar}>
        <Icon name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={onSearchChange}
          placeholder="Search chats"
          placeholderTextColor={colors.textDisabled}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          editable={!isDeleting}
          accessibilityLabel="Search chats"
          testID="chat-search"
        />
        {searchQuery.length > 0 ? (
          <TouchableOpacity
            style={styles.searchClear}
            onPress={() => onSearchChange('')}
            disabled={isDeleting}
            accessibilityRole="button"
            accessibilityLabel="Clear chat search"
            accessibilityState={{ disabled: isDeleting }}
            testID="chat-search-clear"
          >
            <Icon name="x" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>
      <TouchableOpacity
        style={styles.action}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        accessibilityState={{ disabled: isDeleting, busy: isDeleting }}
        disabled={isDeleting}
        onPress={onBulkDeleteAction}
        testID="chat-bulk-delete-action"
      >
        <Icon
          name={isSelecting ? 'check' : 'trash-2'}
          size={18}
          color={isSelecting ? colors.primary : colors.error}
        />
      </TouchableOpacity>
    </View>
  );
};

export const ChatSelectionCheckbox: React.FC<{
  selected: boolean;
  isDeleting?: boolean;
}> = ({ selected, isDeleting = false }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
      {isDeleting ? (
        <LoadingDots
          color={colors.background}
          size={3}
          testID="chat-delete-loading"
        />
      ) : selected ? (
        <Icon name="check" size={14} color={colors.background} />
      ) : null}
    </View>
  );
};

export const ChatSearchEmpty: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.searchEmpty} testID="chat-search-empty">
      <Icon name="search" size={20} color={colors.textMuted} />
      <Text style={styles.searchEmptyText}>No chats match your search.</Text>
    </View>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  toolbar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  searchBar: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    ...shadows.small,
  },
  searchInput: {
    ...TYPOGRAPHY.bodySmall,
    flex: 1,
    color: colors.text,
    paddingVertical: SPACING.sm,
  },
  searchClear: {
    padding: SPACING.xs,
  },
  action: {
    width: 40,
    height: 40,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: 8,
    backgroundColor: colors.surface,
    ...shadows.small,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.md,
  },
  checkboxSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  searchEmpty: {
    alignItems: 'center' as const,
    gap: SPACING.sm,
    paddingVertical: SPACING.xxl,
  },
  searchEmptyText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
});
