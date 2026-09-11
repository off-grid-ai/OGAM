import React, { useEffect, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../../theme';
import { AppSheet } from '../../AppSheet';
import { AnimatedPressable } from '../../AnimatedPressable';

export interface ActionMenuExtraAction {
  readonly label: string;
  readonly icon: React.ComponentProps<typeof Icon>['name'];
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly testID: string;
}

interface ActionMenuSheetProps {
  visible: boolean;
  onClose: () => void;
  isUser: boolean;
  canEdit: boolean;
  canRetry: boolean;
  canGenerateImage: boolean;
  canSpeak: boolean;
  styles: any;
  onCopy: () => void;
  onEdit: () => void;
  onRetry: () => void;
  onGenerateImage: () => void;
  onSpeak: () => void;
  /** Optional host action rendered with the same interaction and visual contract. */
  extraAction?: ActionMenuExtraAction;
}

export function ActionMenuSheet({
  visible,
  onClose,
  isUser,
  canEdit,
  canRetry,
  canGenerateImage,
  canSpeak,
  styles,
  onCopy,
  onEdit,
  onRetry,
  onGenerateImage,
  onSpeak,
  extraAction,
}: ActionMenuSheetProps) {
  const { colors } = useTheme();

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      enableDynamicSizing
      title="Actions"
    >
      <View testID="action-menu" style={styles.actionSheetContent}>
        <AnimatedPressable
          testID="action-copy"
          hapticType="selection"
          style={styles.actionSheetItem}
          onPress={onCopy}
        >
          <Icon name="copy" size={18} color={colors.textSecondary} />
          <Text style={styles.actionSheetText}>Copy</Text>
        </AnimatedPressable>

        {canEdit && (
          <AnimatedPressable
            testID="action-edit"
            hapticType="selection"
            style={styles.actionSheetItem}
            onPress={onEdit}
          >
            <Icon name="edit-2" size={18} color={colors.textSecondary} />
            <Text style={styles.actionSheetText}>Edit</Text>
          </AnimatedPressable>
        )}

        {canRetry && (
          <AnimatedPressable
            testID="action-retry"
            hapticType="selection"
            style={styles.actionSheetItem}
            onPress={onRetry}
          >
            <Icon name="refresh-cw" size={18} color={colors.textSecondary} />
            <Text style={styles.actionSheetText}>
              {isUser ? 'Resend' : 'Regenerate'}
            </Text>
          </AnimatedPressable>
        )}

        {canGenerateImage && (
          <AnimatedPressable
            testID="action-generate-image"
            hapticType="selection"
            style={styles.actionSheetItem}
            onPress={onGenerateImage}
          >
            <Icon name="image" size={18} color={colors.textSecondary} />
            <Text style={styles.actionSheetText}>Generate Image</Text>
          </AnimatedPressable>
        )}

        {!isUser && canSpeak && (
          <AnimatedPressable
            testID="action-speak"
            hapticType="selection"
            style={styles.actionSheetItem}
            onPress={onSpeak}
          >
            <Icon name="volume-2" size={18} color={colors.textSecondary} />
            <Text style={styles.actionSheetText}>Speak</Text>
          </AnimatedPressable>
        )}

        {extraAction && (
          <AnimatedPressable
            testID={extraAction.testID}
            hapticType="selection"
            style={styles.actionSheetItem}
            onPress={extraAction.onPress}
            disabled={extraAction.disabled}
            accessibilityRole="button"
            accessibilityLabel={extraAction.label}
          >
            <Icon
              name={extraAction.icon}
              size={18}
              color={colors.textSecondary}
            />
            <Text style={styles.actionSheetText}>{extraAction.label}</Text>
          </AnimatedPressable>
        )}
      </View>
    </AppSheet>
  );
}

interface EditSheetProps {
  visible: boolean;
  onClose: () => void;
  defaultValue: string;
  /** Receives the text as typed. The draft never leaves this sheet before Save. */
  onSave: (text: string) => void;
  onCancel: () => void;
  resendsAfterSave: boolean;
  styles: any;
  colors: any;
}

/**
 * The edit draft is LOCAL to this sheet. It used to be raised to ChatMessage on every
 * character, which re-rendered the whole message - markdown parse, attachments, tool rows and
 * every overlay - once per keystroke.
 */
export function EditSheet({
  visible,
  onClose,
  defaultValue,
  onSave,
  onCancel,
  resendsAfterSave,
  styles,
  colors,
}: EditSheetProps) {
  const [draft, setDraft] = useState(defaultValue);

  // Reseed when the sheet opens, so an edit always starts from the current message text.
  useEffect(() => {
    if (visible) setDraft(defaultValue);
  }, [visible, defaultValue]);

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      title="EDIT MESSAGE"
      enableDynamicSizing
    >
      <View style={styles.editSheetContent}>
        <TextInput
          style={styles.editInput}
          value={draft}
          onChangeText={setDraft}
          multiline
          autoFocus
          placeholder="Enter message..."
          placeholderTextColor={colors.textMuted}
          textAlignVertical="top"
        />
        <View style={styles.editActions}>
          <AnimatedPressable
            hapticType="selection"
            style={[styles.editButton, styles.editButtonCancel]}
            onPress={onCancel}
          >
            <Text style={styles.editButtonText}>CANCEL</Text>
          </AnimatedPressable>
          <AnimatedPressable
            hapticType="impactMedium"
            style={[styles.editButton, styles.editButtonSave]}
            onPress={() => onSave(draft)}
          >
            <Text style={[styles.editButtonText, styles.editButtonTextSave]}>
              {resendsAfterSave ? 'SAVE & RESEND' : 'SAVE'}
            </Text>
          </AnimatedPressable>
        </View>
      </View>
    </AppSheet>
  );
}
