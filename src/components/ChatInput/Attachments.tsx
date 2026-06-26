import React, { useState, useRef } from 'react';

let _attachmentIdSeq = 0;
const nextAttachmentId = () => `${Date.now()}-${(++_attachmentIdSeq).toString(36)}`;
import { View, Text, Image, ScrollView, TouchableOpacity, Platform, ActionSheetIOS } from 'react-native';
import { launchImageLibrary, launchCamera, Asset } from 'react-native-image-picker';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { MediaAttachment } from '../../types';
import { documentService } from '../../services/documentService';
import { AlertState, showAlert, hideAlert } from '../CustomAlert';
import { createStyles } from './styles';
import { isPickerStuck } from '../../utils/pickerErrorUtils';

// ─── useAttachments hook ──────────────────────────────────────────────────────

export function useAttachments(setAlertState: (state: AlertState) => void) {
  const [attachments, setAttachments] = useState<MediaAttachment[]>([]);
  const isPickingRef = useRef(false);

  const addAttachments = (assets: Asset[]) => {
    const newAttachments: MediaAttachment[] = assets
      .filter(asset => asset.uri)
      .map(asset => ({
        id: nextAttachmentId(),
        type: 'image' as const,
        uri: asset.uri!,
        mimeType: asset.type,
        width: asset.width,
        height: asset.height,
        fileName: asset.fileName,
      }));
    setAttachments(prev => [...prev, ...newAttachments]);
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const pickFromLibrary = async () => {
    try {
      const result = await launchImageLibrary({ mediaType: 'photo', quality: 0.8, maxWidth: 1024, maxHeight: 1024 });
      if (result.assets && result.assets.length > 0) addAttachments(result.assets);
    } catch (_pickError) {
      // no-op: image picker already reports failure to the user via native UI
    }
  };

  const pickFromCamera = async () => {
    try {
      const result = await launchCamera({ mediaType: 'photo', quality: 0.8, maxWidth: 1024, maxHeight: 1024 });
      if (result.assets && result.assets.length > 0) addAttachments(result.assets);
    } catch (_cameraError) {
      // no-op: camera picker already reports failure to the user via native UI
    }
  };

  const handlePickImage = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Camera', 'Photo Library', 'Cancel'], cancelButtonIndex: 2 },
        (index) => {
          if (index === 0) pickFromCamera();
          else if (index === 1) pickFromLibrary();
        },
      );
    } else {
      setAlertState(showAlert(
        'Add Image',
        'Choose image source',
        [
          { text: 'Camera', onPress: () => { setAlertState(hideAlert()); setTimeout(pickFromCamera, 300); } },
          { text: 'Photo Library', onPress: () => { setAlertState(hideAlert()); setTimeout(pickFromLibrary, 300); } },
        ],
      ));
    }
  };

  const handlePickDocument = async () => {
    if (isPickingRef.current) return;
    isPickingRef.current = true;
    try {
      const result = await pick({ type: [types.allFiles], allowMultiSelection: false });
      const file = result[0];
      if (!file) return;
      const fileName = file.name || 'document';
      if (!documentService.isSupported(fileName)) {
        setAlertState(showAlert(
          'Unsupported File',
          `"${fileName}" is not supported. Supported types: txt, md, csv, json, pdf, and code files.`,
          [{ text: 'OK' }],
        ));
        return;
      }
      const attachment = await documentService.processDocumentFromPath(file.uri, fileName);
      if (attachment) setAttachments(prev => [...prev, attachment]);
    } catch (pickError: any) {
      if (isErrorWithCode(pickError) && pickError.code === errorCodes.OPERATION_CANCELED) return;
      if (isPickerStuck(pickError)) {
        setAlertState(showAlert(
          'File Picker Unavailable',
          "The file picker isn't responding. Please close and reopen the app, then try again.",
          [{ text: 'OK' }],
        ));
        return;
      }
      setAlertState(showAlert('Error', pickError.message || 'Failed to read document', [{ text: 'OK' }]));
    } finally {
      isPickingRef.current = false;
    }
  };

  const addAudioAttachment = (uri: string, audioFormat: 'wav' | 'mp3', audioDurationSeconds?: number) => {
    const attachment: MediaAttachment = {
      id: nextAttachmentId(),
      type: 'audio',
      uri,
      audioFormat,
      audioDurationSeconds,
      fileName: uri.split('/').pop(),
    };
    setAttachments(prev => [...prev, attachment]);
  };

  const clearAttachments = () => setAttachments([]);

  return { attachments, removeAttachment, clearAttachments, handlePickImage, handlePickDocument, addAudioAttachment };
}

// ─── AttachmentPreview component ─────────────────────────────────────────────

interface AttachmentPreviewProps {
  attachments: MediaAttachment[];
  onRemove: (id: string) => void;
}

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({ attachments, onRemove }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  if (attachments.length === 0) return null;

  return (
    <ScrollView
      testID="attachments-container"
      horizontal
      style={styles.attachmentsContainer}
      contentContainerStyle={styles.attachmentsContent}
      showsHorizontalScrollIndicator={false}
    >
      {attachments.map(attachment => (
        <View key={attachment.id} testID={`attachment-preview-${attachment.id}`} style={styles.attachmentPreview}>
          {attachment.type === 'image' ? (
            <Image
              testID={`attachment-image-${attachment.id}`}
              source={{ uri: attachment.uri }}
              style={styles.attachmentImage}
            />
          ) : attachment.type === 'audio' ? (
            <View testID={`audio-preview-${attachment.id}`} style={styles.documentPreview}>
              <Icon name="mic" size={24} color={colors.primary} />
              <Text style={styles.documentName} numberOfLines={2}>Voice</Text>
            </View>
          ) : (
            <View testID={`document-preview-${attachment.id}`} style={styles.documentPreview}>
              <Icon name="file-text" size={24} color={colors.primary} />
              <Text style={styles.documentName} numberOfLines={2}>
                {attachment.fileName || 'Document'}
              </Text>
            </View>
          )}
          <TouchableOpacity
            testID={`remove-attachment-${attachment.id}`}
            style={styles.removeAttachment}
            onPress={() => onRemove(attachment.id)}
          >
            <Text style={styles.removeAttachmentText}>&times;</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
};
