import React from 'react';
import { View, Text, TextInput, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../../theme';
import { AppSheet } from '../../AppSheet';
import { AnimatedPressable } from '../../AnimatedPressable';

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
  /** When provided, shows a "Select text" item (chat mode) for partial copy. */
  onSelectText?: () => void;
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
  onSelectText,
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

        {onSelectText && (
          <AnimatedPressable
            testID="action-select-text"
            hapticType="selection"
            style={styles.actionSheetItem}
            onPress={onSelectText}
          >
            <Icon name="type" size={18} color={colors.textSecondary} />
            <Text style={styles.actionSheetText}>Select text</Text>
          </AnimatedPressable>
        )}

        {isUser && canEdit && (
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
      </View>
    </AppSheet>
  );
}

interface SelectTextSheetProps {
  visible: boolean;
  onClose: () => void;
  content: string;
  styles: any;
}

/**
 * Read-only sheet that presents the message text fully selectable, so the user
 * can select part of it and copy via the native selection toolbar. This avoids
 * the conflict where the bubble's long-press opens the action menu before the
 * OS text-selection gesture can start.
 */
export function SelectTextSheet({ visible, onClose, content, styles }: SelectTextSheetProps) {
  return (
    <AppSheet visible={visible} onClose={onClose} title="SELECT TEXT" enableDynamicSizing>
      <View style={styles.selectTextContent}>
        <Text style={styles.selectTextHint}>Long-press to select, then copy.</Text>
        <ScrollView style={styles.selectTextScroll} nestedScrollEnabled>
          <Text selectable testID="select-text-body" style={styles.selectTextBody}>
            {content}
          </Text>
        </ScrollView>
      </View>
    </AppSheet>
  );
}

interface EditSheetProps {
  visible: boolean;
  onClose: () => void;
  defaultValue: string;
  onChangeText: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  styles: any;
  colors: any;
}

export function EditSheet({
  visible,
  onClose,
  defaultValue,
  onChangeText,
  onSave,
  onCancel,
  styles,
  colors,
}: EditSheetProps) {
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
          defaultValue={defaultValue}
          onChangeText={onChangeText}
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
            onPress={onSave}
          >
            <Text style={[styles.editButtonText, styles.editButtonTextSave]}>SAVE & RESEND</Text>
          </AnimatedPressable>
        </View>
      </View>
    </AppSheet>
  );
}
