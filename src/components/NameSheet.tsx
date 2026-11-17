import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { AppSheet } from './AppSheet';
import { Button } from './Button';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';

interface NameSheetProps {
  visible: boolean;
  /** Names the sheet, for the sheet stack and its tests. */
  sheet: string;
  title: string;
  /** One line under the title: what the name is for. */
  hint: string;
  currentName: string;
  /** What the field is called for screen readers, and its placeholder when empty. */
  fieldLabel: string;
  saveLabel?: string;
  testIDPrefix: string;
  maxLength?: number;
  onClose: () => void;
  /** Throws to keep the sheet open with the error's message. */
  onSave: (name: string) => Promise<void>;
}

/** Name or rename one thing: a device, a folder. Typing replaces the current name. */
export const NameSheet: React.FC<NameSheetProps> = ({
  visible,
  sheet,
  title,
  hint,
  currentName,
  fieldLabel,
  saveLabel = 'Save',
  testIDPrefix,
  maxLength = 64,
  onClose,
  onSave,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [draft, setDraft] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    setDraft(currentName);
    setError(null);
    // Focus once the name is in the field, so select-on-focus selects it and typing replaces it.
    const focus = setTimeout(() => field.current?.focus(), 0);
    return () => clearTimeout(focus);
  }, [currentName, visible]);

  const close = (): void => {
    if (!saving) onClose();
  };

  const save = async (): Promise<void> => {
    if (!draft.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error && saveError.message ? saveError.message : "Couldn't save the name.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppSheet
      sheet={sheet}
      visible={visible}
      onClose={close}
      onHeaderClosePress={close}
      title={title}
      closeLabel="Cancel"
      enableDynamicSizing
    >
      <View style={styles.content}>
        <Text style={styles.hint}>{hint}</Text>
        <TextInput
          testID={`${testIDPrefix}-input`}
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          maxLength={maxLength}
          ref={field}
          autoCorrect={false}
          selectTextOnFocus
          accessibilityLabel={fieldLabel}
          placeholder={fieldLabel}
          placeholderTextColor={colors.textMuted}
          returnKeyType="done"
          onSubmitEditing={() => save()}
        />
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {/* One way to cancel: the header's Cancel (a second one beside Save said the same thing twice). */}
        <View style={styles.actions}>
          <Button
            title={saving ? 'Saving...' : saveLabel}
            variant="primary"
            size="small"
            loading={saving}
            disabled={!draft.trim()}
            onPress={() => save()}
            testID={`${testIDPrefix}-save`}
          />
        </View>
      </View>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors) => ({
  // The sheet title's 24 pt gutter, so the body lines up under it.
  content: { paddingHorizontal: SPACING.xl, paddingTop: SPACING.md, paddingBottom: SPACING.lg, gap: SPACING.md },
  hint: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  input: {
    ...TYPOGRAPHY.body,
    minHeight: 44,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    backgroundColor: colors.surfaceLight,
  },
  error: { ...TYPOGRAPHY.bodySmall, color: colors.error },
  actions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: SPACING.sm },
});
