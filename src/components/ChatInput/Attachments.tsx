import React, { useState, useRef } from 'react';

let _attachmentIdSeq = 0;
const nextAttachmentId = () => `${Date.now()}-${(++_attachmentIdSeq).toString(36)}`;
import { View, Text, Image, ScrollView, TouchableOpacity, Platform, ActionSheetIOS, ActivityIndicator } from 'react-native';
import { launchImageLibrary, launchCamera, Asset } from 'react-native-image-picker';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { MediaAttachment } from '../../types';
import { documentService } from '../../services/documentService';
import { takePendingChatAttachments } from '../../services/chatAttachmentInbox';
import { AlertState, showAlert, hideAlert } from '../CustomAlert';
import { createStyles } from './styles';
import { isPickerStuck } from '../../utils/pickerErrorUtils';

// ─── useAttachments hook ──────────────────────────────────────────────────────

export function useAttachments(setAlertState: (state: AlertState) => void) {
  // Seed from the inbox (e.g. a transcript handed off by the Pro recorder's
  // "Attach to chat"), consumed once on mount.
  const [attachments, setAttachments] = useState<MediaAttachment[]>(() => takePendingChatAttachments());
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

  const addAudioAttachment = (audio: {
    uri: string;
    audioFormat: 'wav' | 'mp3';
    audioDurationSeconds?: number;
    transcription?: string;
  }) => {
    const attachment: MediaAttachment = {
      id: nextAttachmentId(),
      type: 'audio',
      uri: audio.uri,
      audioFormat: audio.audioFormat,
      audioDurationSeconds: audio.audioDurationSeconds,
      fileName: audio.uri.split('/').pop(),
      // Reuse `textContent` (the attachment's associated text) for the whisper
      // transcription. This is display-only for audio: llmMessages sends the
      // transcription to the model via `message.content`, never from here.
      ...(audio.transcription?.trim() ? { textContent: audio.transcription.trim() } : {}),
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
  // Summarize a document/transcript attachment that may be too large for the
  // context window. Optional so other ChatInput consumers can omit it.
  onSummarize?: (attachment: MediaAttachment) => void;
  summarizingId?: string | null;
}

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({ attachments, onRemove, onSummarize, summarizingId }) => {
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
      {attachments.map(attachment => {
        const canSummarize = !!onSummarize && !!attachment.textContent && attachment.type !== 'image';
        const isBusy = summarizingId === attachment.id;
        return (
          <View
            key={attachment.id}
            testID={`attachment-preview-${attachment.id}`}
            style={[styles.attachmentPreview, canSummarize && styles.attachmentPreviewDoc]}
          >
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
              <View
                testID={`document-preview-${attachment.id}`}
                style={[styles.documentPreview, canSummarize && styles.documentPreviewDoc]}
              >
                <View style={styles.documentNameRow}>
                  <Icon name="file-text" size={18} color={colors.primary} />
                  <Text style={styles.documentName} numberOfLines={1}>
                    {attachment.fileName || 'Document'}
                  </Text>
                </View>
                {canSummarize ? (
                  isBusy ? (
                    <View style={styles.summarizeBusy}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.summarizeBusyText}>Summarizing</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      testID={`summarize-attachment-${attachment.id}`}
                      style={styles.summarizeButton}
                      onPress={() => onSummarize!(attachment)}
                      activeOpacity={0.8}
                    >
                      <Icon name="zap" size={11} color={colors.background} />
                      <Text style={styles.summarizeButtonText}>Summarize</Text>
                    </TouchableOpacity>
                  )
                ) : null}
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
        );
      })}
    </ScrollView>
  );
};
