import React, { useEffect, useState } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Pressable } from '../Touchable';
import { AppSheet } from '../AppSheet';
import { Button } from '../Button';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';

/** Ties the multiline field to its Done bar. iOS needs a stable id shared by both. */
const NOTE_ACCESSORY_ID = 'paste-note-accessory';

interface PasteNoteSheetProps {
  visible: boolean;
  onClose: () => void;
  onSave: (title: string, text: string) => Promise<void>;
}

/**
 * Paste text straight into a knowledge base.
 *
 * Most of what people want the model to know is not a file - it is a page they copied, a spec, a
 * thread. Making them save it as a document first, then import it, is a detour through the
 * filesystem for no reason. What is saved here becomes an ordinary knowledge-base document, so it is
 * indexed, searchable and synced like any other.
 *
 * The title is optional: an untitled note is stamped with the moment it was saved rather than
 * refusing to save.
 */
export const PasteNoteSheet: React.FC<PasteNoteSheetProps> = ({
  visible,
  onClose,
  onSave,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // The sheet grows by exactly what the keyboard covers, so "Save to knowledge base" is always
  // reachable. Without this it sits UNDER the keyboard, and this sheet gives no way out: the text
  // field is multiline so the return key inserts a newline instead of dismissing, and the backdrop
  // is the sheet's own close gesture. The note could be typed and then never saved.
  const keyboardHeight = useKeyboardHeight();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle('');
    setText('');
    setError(null);
  }, [visible]);

  const close = (): void => {
    if (!saving) onClose();
  };

  const save = async (): Promise<void> => {
    if (saving || !text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(title, text);
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Could not save this note.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppSheet
      visible={visible}
      onClose={close}
      onHeaderClosePress={close}
      title="Add text"
      closeLabel="Cancel"
      enableDynamicSizing
    >
      <View
        style={[
          styles.content,
          { paddingBottom: SPACING.lg + keyboardHeight },
        ]}
      >
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          placeholder="Title (optional)"
          placeholderTextColor={colors.textMuted}
          maxLength={60}
          accessibilityLabel="Note title"
          testID="paste-note-title"
        />
        <TextInput
          style={[
            styles.textInput,
            // The field grows with what is pasted. With the keyboard up, that growth is what pushes
            // Save off the bottom of the screen - the sheet can only lift so far. So cap it while
            // the keyboard is showing: the pasted text still scrolls inside its own box, and the
            // action stays where a thumb can reach it.
            keyboardHeight > 0 ? styles.textInputWithKeyboard : null,
          ]}
          value={text}
          onChangeText={setText}
          placeholder="Paste or type the text to remember"
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
          autoFocus
          accessibilityLabel="Note text"
          testID="paste-note-text"
          inputAccessoryViewID={NOTE_ACCESSORY_ID}
        />
        {/* A multiline field has no return key to dismiss with, so iOS needs an explicit way out. */}
        {Platform.OS === 'ios' ? (
          <InputAccessoryView nativeID={NOTE_ACCESSORY_ID}>
            <View style={styles.accessory}>
              <Pressable
                onPress={() => Keyboard.dismiss()}
                accessibilityRole="button"
                accessibilityLabel="Dismiss keyboard"
                testID="paste-note-keyboard-done"
                hitSlop={8}
              >
                <Text style={styles.accessoryAction}>Done</Text>
              </Pressable>
            </View>
          </InputAccessoryView>
        ) : null}
        {/* The one fact the field cannot show: how much was pasted. */}
        {text.length > 0 ? (
          <Text style={styles.count}>
            {text.length.toLocaleString()} characters
          </Text>
        ) : null}
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button
          title="Save to knowledge base"
          variant="primary"
          loading={saving}
          disabled={!text.trim()}
          onPress={() => save()}
          testID="paste-note-save"
        />
      </View>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors) => ({
  content: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
    gap: SPACING.md,
  },
  titleInput: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    backgroundColor: colors.surfaceLight,
    minHeight: 44,
  },
  textInput: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    backgroundColor: colors.surfaceLight,
    // Tall enough that a pasted page is visibly a page, and scrolls inside its own box.
    minHeight: 220,
    maxHeight: 320,
  },
  textInputWithKeyboard: {
    minHeight: 120,
    maxHeight: 160,
  },
  count: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  error: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.error,
  },
  accessory: {
    alignItems: 'flex-end' as const,
    backgroundColor: colors.surfaceLight,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  accessoryAction: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
  },
});
