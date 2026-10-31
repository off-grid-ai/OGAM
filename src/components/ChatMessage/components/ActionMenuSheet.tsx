import React, { useEffect, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
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
  canTranscribeAgain?: boolean;
  styles: any;
  onCopy: () => void;
  onEdit: () => void;
  onRetry: () => void;
  onGenerateImage: () => void;
  onSpeak: () => void;
  onTranscribeAgain?: () => void;
}

export function ActionMenuSheet({
  visible,
  onClose,
  isUser,
  canEdit,
  canRetry,
  canGenerateImage,
  canSpeak,
  canTranscribeAgain = false,
  styles,
  onCopy,
  onEdit,
  onRetry,
  onGenerateImage,
  onSpeak,
  onTranscribeAgain,
}: ActionMenuSheetProps) {
  const { colors } = useTheme();

  return (
    <AppSheet
      sheet="message-actions"
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

        {canTranscribeAgain && onTranscribeAgain && (
          <AnimatedPressable
            testID="action-transcribe-again"
            hapticType="selection"
            style={styles.actionSheetItem}
            onPress={onTranscribeAgain}
          >
            <Icon name="mic" size={18} color={colors.textSecondary} />
            <Text style={styles.actionSheetText}>Transcribe again</Text>
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

interface EditSheetProps {
  visible: boolean;
  onClose: () => void;
  defaultValue: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  resendsAfterSave: boolean;
  styles: any;
  colors: any;
}

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
  useEffect(() => {
    if (visible) setDraft(defaultValue);
  }, [visible, defaultValue]);
  return (
    <AppSheet
      sheet="message-edit"
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
