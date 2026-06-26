import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { MediaAttachment } from '../../../types';
import { viewDocument } from '@react-native-documents/viewer';
import logger from '../../../utils/logger';

interface FadeInImageProps {
  uri: string;
  imageStyle: any;
  testID?: string;
  wrapperTestID?: string;
  onPress?: () => void;
}

function FadeInImage({ uri, imageStyle, testID, wrapperTestID, onPress }: FadeInImageProps) {
  const opacity = useSharedValue(0);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
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
          onLoad={() => { opacity.value = withTiming(1, { duration: 300 }); }}
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
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024) { return `${bytes}B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(0)}KB`; }
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
            style={[
              styles.documentBadge,
              isUser ? styles.documentBadgeUser : styles.documentBadgeAssistant,
            ]}
          >
            <Icon name="mic" size={14} color={isUser ? colors.background : colors.textSecondary} />
            <Text
              style={[styles.documentBadgeText, isUser ? styles.documentBadgeTextUser : styles.documentBadgeTextAssistant]}
            >
              Voice message
            </Text>
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
              if (!attachment.uri) { return; }
              const ext = (attachment.fileName || '').split('.').pop()?.toLowerCase();
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
              const mimeType = ext ? mimeMap[ext] || 'application/octet-stream' : undefined;
              let uri = attachment.uri;
              if (uri.startsWith('/')) {
                uri = `file://${uri}`;
              } else if (!uri.includes('://')) {
                uri = `file://${uri}`;
              }
              logger.log('[ChatMessage] Opening document:', uri);
              viewDocument({ uri, mimeType, grantPermissions: 'read' }).catch((err: any) => {
                logger.warn('[ChatMessage] Failed to open document:', err?.message || err);
              });
            }}
            activeOpacity={0.7}
          >
            <Icon name="file-text" size={14} color={isUser ? colors.background : colors.textSecondary} />
            <Text
              style={[
                styles.documentBadgeText,
                isUser ? styles.documentBadgeTextUser : styles.documentBadgeTextAssistant,
              ]}
              numberOfLines={1}
            >
              {attachment.fileName || 'Document'}
            </Text>
            {attachment.fileSize != null && (
              <Text
                style={[
                  styles.documentBadgeSize,
                  isUser ? styles.documentBadgeSizeUser : styles.documentBadgeSizeAssistant,
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
            wrapperTestID={isUser ? `message-attachment-${index}` : 'generated-image'}
            testID={isUser ? `message-image-${index}` : 'generated-image-content'}
            onPress={() => onImagePress?.(attachment.uri)}
          />
        )
      )}
    </View>
  );
}
