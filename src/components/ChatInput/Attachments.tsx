import React, { useRef, useState } from 'react';

let _attachmentIdSeq = 0;
const nextAttachmentId = () => `${Date.now()}-${(++_attachmentIdSeq).toString(36)}`;
import { ActionSheetIOS, Platform, View, Text, Image, ScrollView, TouchableOpacity } from 'react-native';
import { launchImageLibrary, launchCamera, Asset } from 'react-native-image-picker';
import { types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { MediaAttachment } from '../../types';
import { documentService } from '../../services/documentService';
import { AlertState, showAlert, hideAlert } from '../CustomAlert';
import { createStyles } from './styles';
import logger from '../../utils/logger';
import {
  __resetDocumentPickerCoordinatorForTests,
  pickDocumentWithCoordinator,
  useDocumentPickerActive,
} from '../../utils/documentPickerCoordinator';

// ─── useAttachments hook ──────────────────────────────────────────────────────
export const __resetAttachmentPickerForTests = () => {
  __resetDocumentPickerCoordinatorForTests();
};

export function useAttachments(setAlertState: (state: AlertState) => void) {
  const [attachments, setAttachments] = useState<MediaAttachment[]>([]);
  const isDocumentPickerActive = useDocumentPickerActive();
  const [isMediaPickerActive, setIsMediaPickerActive] = useState(false);
  const mediaPickerInFlightRef = useRef(false);

  const runMediaPicker = async (source: 'photo-library' | 'camera', action: () => Promise<void>) => {
    if (mediaPickerInFlightRef.current) {
      logger.warn('[ChatInput][Attachments]', 'media-picker-blocked-busy', { source });
      return;
    }

    mediaPickerInFlightRef.current = true;
    setIsMediaPickerActive(true);
    try {
      await action();
    } finally {
      mediaPickerInFlightRef.current = false;
      setIsMediaPickerActive(false);
    }
  };

  const isPickerActive = isDocumentPickerActive || isMediaPickerActive;

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
    await runMediaPicker('photo-library', async () => {
      try {
        const result = await launchImageLibrary({ mediaType: 'photo', quality: 0.8, maxWidth: 1024, maxHeight: 1024 });
        if (result.assets && result.assets.length > 0) addAttachments(result.assets);
      } catch (pickError) {
        logger.error('Error picking image:', pickError);
        logger.warn('[ChatInput][Attachments]', 'image-library-error', {
          error: pickError instanceof Error ? pickError.message : String(pickError),
        });
      }
    });
  };

  const pickFromCamera = async () => {
    await runMediaPicker('camera', async () => {
      try {
        const result = await launchCamera({ mediaType: 'photo', quality: 0.8, maxWidth: 1024, maxHeight: 1024 });
        if (result.assets && result.assets.length > 0) addAttachments(result.assets);
      } catch (cameraError) {
        logger.error('Error taking photo:', cameraError);
        logger.warn('[ChatInput][Attachments]', 'camera-error', {
          error: cameraError instanceof Error ? cameraError.message : String(cameraError),
        });
      }
    });
  };

  const handlePickImage = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Camera', 'Photo Library', 'Cancel'],
          cancelButtonIndex: 2,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) {
            setTimeout(pickFromCamera, 300);
            return;
          }

          if (buttonIndex === 1) {
            setTimeout(pickFromLibrary, 300);
          }
        },
      );
      return;
    }
    setAlertState(showAlert(
      'Add Image',
      'Choose image source',
      [
        {
          text: 'Camera',
          onPress: () => {
            setAlertState(hideAlert());
            setTimeout(pickFromCamera, 300);
          },
        },
        {
          text: 'Photo Library',
          onPress: () => {
            setAlertState(hideAlert());
            setTimeout(pickFromLibrary, 300);
          },
        },
      ],
    ));
  };

  const handlePickDocument = async () => {
    try {
      const result = await pickDocumentWithCoordinator('chat-attachment', {
        type: [types.allFiles],
        allowMultiSelection: false,
        presentationStyle: 'fullScreen',
      });
      const file = result?.[0];
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
      logger.error('Error picking document:', pickError);
      logger.warn('[ChatInput][Attachments]', 'document-picker-error', {
        message: pickError?.message || null,
        code: pickError?.code || null,
      });
      setAlertState(showAlert('Error', pickError.message || 'Failed to read document', [{ text: 'OK' }]));
    }
  };

  const clearAttachments = () => setAttachments([]);

  return { attachments, isPickerActive, removeAttachment, clearAttachments, handlePickImage, handlePickDocument };
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
