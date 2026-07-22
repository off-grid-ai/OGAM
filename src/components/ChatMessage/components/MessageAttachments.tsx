import React, { useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { MediaAttachment } from '../../../types';
import { viewDocument } from '@react-native-documents/viewer';
import logger from '../../../utils/logger';
import { imageAttachmentService } from '../../../services/imageAttachmentService';

interface FadeInImageProps {
  uri: string;
  imageStyle: any;
  colors: any;
  testID?: string;
  wrapperTestID?: string;
  onPress?: () => void;
}

function FadeInImage({
  uri,
  imageStyle,
  colors,
  testID,
  wrapperTestID,
  onPress,
}: FadeInImageProps) {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const opacity = useSharedValue(0);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  useEffect(() => {
    let mounted = true;
    imageAttachmentService.exists(uri).then(exists => {
      if (mounted) setIsAvailable(exists);
    });
    return () => {
      mounted = false;
    };
  }, [uri]);

  if (isAvailable === false) {
    return (
      <View
        testID={wrapperTestID}
        style={[imageStyle, fadeInImageStyles.missing]}
      >
        <Icon name="image" size={24} color={colors.textMuted} />
        <Text
          testID="missing-image-attachment"
          style={[fadeInImageStyles.missingText, { color: colors.text }]}
        >
          Image unavailable
        </Text>
        <Text
          style={[fadeInImageStyles.missingDetail, { color: colors.textMuted }]}
        >
          This image is no longer on this device.
        </Text>
      </View>
    );
  }
  return (
    <Animated.View style={[fadeInImageStyles.wrapper, fadeStyle]}>
      <TouchableOpacity
        testID={wrapperTestID}
        style={fadeInImageStyles.wrapper}
        onPress={onPress}
        activeOpacity={0.8}
      >
        <Image
          testID={testID}
          source={{ uri }}
          style={imageStyle}
          resizeMode="cover"
          onLoad={() => {
            opacity.value = withTiming(1, { duration: 300 });
          }}
        />
      </TouchableOpacity>
    </Animated.View>
  );
}

const fadeInImageStyles = StyleSheet.create({
  wrapper: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  missing: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  missingText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  missingDetail: {
    fontSize: 10,
    textAlign: 'center',
  },
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

interface MessageAttachmentsProps {
  attachments: MediaAttachment[];
  isUser: boolean;
  styles: any;
  colors: any;
  onImagePress?: (uri: string) => void;
}

export function MessageAttachments({
  attachments,
  isUser,
  styles,
  colors,
  onImagePress,
}: MessageAttachmentsProps) {
  return (
    <View testID="message-attachments" style={styles.attachmentsContainer}>
      {attachments.map((attachment, index) =>
        attachment.type === 'audio' ? (
          <View
            key={attachment.id}
            testID={`audio-badge-${index}`}
            style={[
              styles.audioBadge,
              isUser ? styles.documentBadgeUser : styles.documentBadgeAssistant,
            ]}
          >
            <View style={styles.audioBadgeHeader}>
              <Icon
                name="mic"
                size={14}
                color={isUser ? colors.background : colors.textSecondary}
              />
              <Text
                style={[
                  styles.documentBadgeText,
                  isUser
                    ? styles.documentBadgeTextUser
                    : styles.documentBadgeTextAssistant,
                ]}
              >
                Voice message
              </Text>
            </View>
            {attachment.textContent ? (
              <Text
                testID={`audio-transcription-${index}`}
                style={[
                  styles.audioTranscription,
                  isUser
                    ? styles.documentBadgeTextUser
                    : styles.documentBadgeTextAssistant,
                ]}
              >
                {attachment.textContent}
              </Text>
            ) : null}
          </View>
        ) : attachment.type === 'document' ? (
          <TouchableOpacity
            key={attachment.id}
            testID={`document-badge-${index}`}
            style={[
              styles.documentBadge,
              isUser ? styles.documentBadgeUser : styles.documentBadgeAssistant,
            ]}
            onPress={() => {
              if (!attachment.uri) {
                return;
              }
              const ext = (attachment.fileName || '')
                .split('.')
                .pop()
                ?.toLowerCase();
              const mimeMap: Record<string, string> = {
                pdf: 'application/pdf',
                txt: 'text/plain',
                md: 'text/markdown',
                csv: 'text/csv',
                json: 'application/json',
                xml: 'application/xml',
                html: 'text/html',
                py: 'text/x-python',
                js: 'text/javascript',
                ts: 'text/typescript',
              };
              const mimeType = ext
                ? mimeMap[ext] || 'application/octet-stream'
                : undefined;
              let uri = attachment.uri;
              if (uri.startsWith('/') || !uri.includes('://')) {
                uri = `file://${uri}`;
              }
              logger.log('[ChatMessage] Opening document:', uri);
              viewDocument({ uri, mimeType, grantPermissions: 'read' }).catch(
                (err: any) => {
                  logger.warn(
                    '[ChatMessage] Failed to open document:',
                    err?.message || err,
                  );
                },
              );
            }}
            activeOpacity={0.7}
          >
            <Icon
              name="file-text"
              size={14}
              color={isUser ? colors.background : colors.textSecondary}
            />
            <Text
              style={[
                styles.documentBadgeText,
                isUser
                  ? styles.documentBadgeTextUser
                  : styles.documentBadgeTextAssistant,
              ]}
              numberOfLines={1}
            >
              {attachment.fileName || 'Document'}
            </Text>
            {attachment.fileSize != null && (
              <Text
                style={[
                  styles.documentBadgeSize,
                  isUser
                    ? styles.documentBadgeSizeUser
                    : styles.documentBadgeSizeAssistant,
                ]}
              >
                {formatFileSize(attachment.fileSize)}
              </Text>
            )}
          </TouchableOpacity>
        ) : (
          <FadeInImage
            key={attachment.id}
            uri={attachment.uri}
            imageStyle={styles.attachmentImage}
            colors={colors}
            wrapperTestID={
              isUser ? `message-attachment-${index}` : 'generated-image'
            }
            testID={
              isUser ? `message-image-${index}` : 'generated-image-content'
            }
            onPress={() => onImagePress?.(attachment.uri)}
          />
        ),
      )}
    </View>
  );
}
