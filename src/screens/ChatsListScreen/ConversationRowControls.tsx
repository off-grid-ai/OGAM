import React from 'react';
import { TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import type { Conversation } from '../../types';

export function formatConversationDate(dateString: string): string {
  const date = new Date(dateString);
  const diffDays = Math.floor(
    (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

type RowActionsProps = {
  conversation: Conversation;
  onRename: () => void;
  onDelete: () => void;
};

export const ConversationRowActions: React.FC<RowActionsProps> = ({
  conversation,
  onRename,
  onDelete,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.rowActions}>
      <TouchableOpacity
        style={styles.editAction}
        onPress={onRename}
        testID={`rename-conversation-${conversation.id}`}
        accessibilityLabel={`Rename ${conversation.title}`}
      >
        <Icon name="edit-2" size={16} color={colors.text} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.deleteAction}
        onPress={onDelete}
        testID={`delete-conversation-${conversation.id}`}
        accessibilityLabel={`Delete ${conversation.title}`}
      >
        <Icon name="trash-2" size={16} color={colors.error} />
      </TouchableOpacity>
    </View>
  );
};

type RenameRowProps = {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

export const ConversationRenameRow: React.FC<RenameRowProps> = ({
  value,
  onChange,
  onSave,
  onCancel,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.renameRow}>
      <TextInput
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSave}
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
        style={styles.renameInput}
        testID="conversation-rename-input"
        accessibilityLabel="Conversation name"
      />
      <TouchableOpacity
        onPress={onSave}
        disabled={!value.trim()}
        style={styles.renameAction}
        testID="conversation-rename-save"
        accessibilityLabel="Save conversation name"
      >
        <Icon name="check" size={16} color={colors.primary} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onCancel}
        style={styles.renameAction}
        testID="conversation-rename-cancel"
        accessibilityLabel="Cancel rename"
      >
        <Icon name="x" size={16} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  rowActions: {
    flexDirection: 'row' as const,
    gap: SPACING.sm,
    marginLeft: SPACING.sm,
  },
  editAction: {
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    width: 44,
    borderRadius: SPACING.sm,
    marginBottom: SPACING.md,
  },
  deleteAction: {
    backgroundColor: colors.errorBackground,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    width: 44,
    borderRadius: SPACING.sm,
    marginBottom: SPACING.md,
  },
  renameRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  renameInput: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.borderFocus,
    borderRadius: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    flex: 1,
  },
  renameAction: {
    width: 44,
    minHeight: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
});
