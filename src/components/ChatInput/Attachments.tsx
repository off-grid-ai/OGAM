import React, { useState, useRef } from 'react';

import {
  View,
  Text,
  Image,
  ScrollView,
  Platform,
  ActionSheetIOS,
} from 'react-native';
import { TouchableOpacity } from '../Touchable';
import {
  launchImageLibrary,
  launchCamera,
  Asset,
} from 'react-native-image-picker';
import {
  pick,
  types,
  isErrorWithCode,
  errorCodes,
} from '@react-native-documents/picker';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { MediaAttachment } from '../../types';
import { documentService } from '../../services/documentService';
import { useDocumentProgressStore } from '../../services/documents/progressStore';
import { audioSessionManager } from '../../services/audioSessionManager';
import { AlertState, showAlert, hideAlert } from '../CustomAlert';
import { createStyles } from './styles';
import { isPickerStuck } from '../../utils/pickerErrorUtils';
import { generateId } from '../../utils/generateId';

// ─── useAttachments hook ──────────────────────────────────────────────────────

export function useAttachments(setAlertState: (state: AlertState) => void) {
  const [attachments, setAttachments] = useState<MediaAttachment[]>([]);
  const isPickingRef = useRef(false);

  const addAttachments = (assets: Asset[]) => {
    const newAttachments: MediaAttachment[] = assets
      .filter(asset => asset.uri)
      .map(asset => ({
        id: generateId(),
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
      // Release the iOS audio session first: in voice mode the active playback session
      // collides with the native picker and hangs the app (device 2026-07-15). No-op on
      // Android and when no session is active.
      await audioSessionManager.deactivate();
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.8,
        maxWidth: 1024,
        maxHeight: 1024,
      });
      if (result.assets && result.assets.length > 0)
        addAttachments(result.assets);
    } catch (_pickError) {
      // no-op: image picker already reports failure to the user via native UI
    } finally {
      // Re-assert the playback session: if the user CANCELS the picker we deactivated for, voice
      // mode would otherwise stay muted until the next audio action (Gitar). iOS-only no-op on Android.
      audioSessionManager.ensurePlayback().catch(() => {});
    }
  };

  const pickFromCamera = async () => {
    try {
      // Release the iOS audio session first (see pickFromLibrary): the camera grabs audio
      // hardware and collides with an active voice-mode session. No-op on Android.
      await audioSessionManager.deactivate();
      const result = await launchCamera({
        mediaType: 'photo',
        quality: 0.8,
        maxWidth: 1024,
        maxHeight: 1024,
      });
      if (result.assets && result.assets.length > 0)
        addAttachments(result.assets);
    } catch (_cameraError) {
      // no-op: camera picker already reports failure to the user via native UI
    } finally {
      // Re-assert the playback session on cancel/return so voice mode isn't left muted (Gitar).
      audioSessionManager.ensurePlayback().catch(() => {});
    }
  };

  const handlePickImage = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Camera', 'Photo Library', 'Cancel'],
          cancelButtonIndex: 2,
        },
        index => {
          if (index === 0) pickFromCamera();
          else if (index === 1) pickFromLibrary();
        },
      );
    } else {
      setAlertState(
        showAlert('Add Image', 'Choose image source', [
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
        ]),
      );
    }
  };

  const handlePickDocument = async () => {
    if (isPickingRef.current) return;
    isPickingRef.current = true;
    try {
      const result = await pick({
        type: [types.allFiles],
        allowMultiSelection: false,
      });
      const file = result[0];
      if (!file) return;
      const fileName = file.name || 'document';
      if (!documentService.isSupported(fileName)) {
        setAlertState(
          showAlert(
            'Unsupported File',
            `"${fileName}" is not supported. Supported types: txt, md, csv, json, pdf, and code files.`,
            [{ text: 'OK' }],
          ),
        );
        return;
      }
      // Kept and indexed in the background: any size, every page, usable in later turns too.
      const attachment = await documentService.attachDocument(file.uri, fileName);
      setAttachments(prev => [...prev, attachment]);
    } catch (pickError: any) {
      if (
        isErrorWithCode(pickError) &&
        pickError.code === errorCodes.OPERATION_CANCELED
      )
        return;
      if (isPickerStuck(pickError)) {
        setAlertState(
          showAlert(
            'File Picker Unavailable',
            "The file picker isn't responding. Please close and reopen the app, then try again.",
            [{ text: 'OK' }],
          ),
        );
        return;
      }
      setAlertState(
        showAlert('Error', pickError.message || 'Failed to read document', [
          { text: 'OK' },
        ]),
      );
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
      id: generateId(),
      type: 'audio',
      uri: audio.uri,
      audioFormat: audio.audioFormat,
      audioDurationSeconds: audio.audioDurationSeconds,
      fileName: audio.uri.split('/').pop(),
      // Reuse `textContent` (the attachment's associated text) for the whisper
      // transcription. This is display-only for audio: llmMessages sends the
      // transcription to the model via `message.content`, never from here.
      ...(audio.transcription?.trim()
        ? { textContent: audio.transcription.trim() }
        : {}),
    };
    setAttachments(prev => [...prev, attachment]);
  };

  const clearAttachments = () => setAttachments([]);

  return {
    attachments,
    removeAttachment,
    clearAttachments,
    handlePickImage,
    handlePickDocument,
    addAudioAttachment,
  };
}

// ─── AttachmentPreview component ─────────────────────────────────────────────

interface AttachmentPreviewProps {
  attachments: MediaAttachment[];
  onRemove: (id: string) => void;
  /** Tapping an image thumbnail opens the shared fullscreen image viewer (same
   * handler the in-message generated/attached images use). Optional so the
   * component still renders without a viewer wired up. */
  onImagePress?: (uri: string) => void;
}

const PHASE_LABEL = { reading: 'Reading', ocr: 'Scanning', indexing: 'Indexing' } as const;

/** Background reading progress under a document chip: "Reading 40%", then "1,204 pages". */
const DocumentStatus: React.FC<{ documentId: string; style: any }> = ({ documentId, style }) => {
  const progress = useDocumentProgressStore(state => state.byId[documentId]);
  if (!progress) return null;
  let label: string;
  if (progress.phase === 'failed') label = "Couldn't read";
  else if (progress.phase === 'ready')
    label = `${progress.pageCount.toLocaleString()} page${progress.pageCount === 1 ? '' : 's'}`;
  else {
    const percent = progress.total ? Math.min(99, Math.round((progress.done / progress.total) * 100)) : 0;
    label = `${PHASE_LABEL[progress.phase]} ${percent}%`;
  }
  return (
    <Text testID={`document-status-${documentId}`} style={style} numberOfLines={1}>
      {label}
    </Text>
  );
};

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({
  attachments,
  onRemove,
  onImagePress,
}) => {
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
        <View
          key={attachment.id}
          testID={`attachment-preview-${attachment.id}`}
          style={styles.attachmentPreview}
        >
          {attachment.type === 'image' ? (
            <TouchableOpacity
              testID={`attachment-image-${attachment.id}`}
              activeOpacity={0.8}
              disabled={!onImagePress}
              onPress={() => onImagePress?.(attachment.uri)}
            >
              <Image
                source={{ uri: attachment.uri }}
                style={styles.attachmentImage}
              />
            </TouchableOpacity>
          ) : attachment.type === 'audio' ? (
            <View
              testID={`audio-preview-${attachment.id}`}
              style={styles.documentPreview}
            >
              <Icon name="mic" size={24} color={colors.primary} />
              <Text style={styles.documentName} numberOfLines={2}>
                Voice
              </Text>
            </View>
          ) : (
            <View
              testID={`document-preview-${attachment.id}`}
              style={styles.documentPreview}
            >
              <Icon name="file-text" size={attachment.documentId ? 18 : 24} color={colors.primary} />
              <Text style={styles.documentName} numberOfLines={attachment.documentId ? 1 : 2}>
                {attachment.fileName || 'Document'}
              </Text>
              {attachment.documentId && (
                <DocumentStatus documentId={attachment.documentId} style={styles.documentStatus} />
              )}
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
