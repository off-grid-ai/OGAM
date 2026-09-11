import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
// Imported directly, not through the barrel: a component that reaches its sibling via the index
// resolves undefined at render time.
import { LoadingDots } from '../../LoadingDots';
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

function FadeInImage({
  uri,
  imageStyle,
  testID,
  wrapperTestID,
  onPress,
}: FadeInImageProps) {
  const opacity = useSharedValue(0);
  const [loaded, setLoaded] = React.useState(false);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const isGeneratedImage = wrapperTestID === 'generated-image';
  return (
    <Animated.View style={[fadeInImageStyles.wrapper, fadeStyle]}>
      <TouchableOpacity
        testID={wrapperTestID}
        style={fadeInImageStyles.wrapper}
        onPress={onPress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={
          isGeneratedImage
            ? `Generated image ${loaded ? 'loaded' : 'loading'}`
            : undefined
        }
      >
        <Image
          testID={testID}
          source={{ uri }}
          style={imageStyle}
          resizeMode="cover"
          onLoad={() => {
            setLoaded(true);
            opacity.value = withTiming(1, { duration: 300 });
          }}
          onError={event => {
            logger.error(
              '[ChatMessage] local image failed to load',
              event.nativeEvent.error,
              uri,
            );
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
});

/**
 * The shape to draw an image at, from the only thing that knows it.
 *
 * Square when the sender did not say: a wrong guess at least fills the space evenly, whereas a fixed
 * height crops every picture that is not the shape the height assumed. The dimensions travel with a
 * shared file, so an image from another device has them too.
 */
function imageAspectRatio(attachment: MediaAttachment): number {
  const { width, height } = attachment;
  return width && height && width > 0 && height > 0 ? width / height : 1;
}

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

/**
 * A file a peer has NAMED whose bytes have not arrived.
 *
 * Its own component, not a branch in the map: everything below reads `uri`, and this is the one case
 * that has none. Keeping it separate also keeps the row list readable - the map was one expression
 * deciding audio, document, image AND this.
 */
function ArrivingAttachment({
  attachment,
  index,
  isUser,
  styles,
  colors,
}: {
  attachment: MediaAttachment;
  index: number;
  isUser: boolean;
  styles: any;
  colors: any;
}) {
  return (
    <View
      testID={`attachment-pending-${index}`}
      style={[
        styles.documentBadge,
        isUser ? styles.documentBadgeUser : styles.documentBadgeAssistant,
      ]}
    >
      <LoadingDots
        size={5}
        color={colors.primary}
        testID={`attachment-pending-dots-${index}`}
      />
      <Text
        numberOfLines={1}
        style={[
          styles.documentBadgeText,
          isUser
            ? styles.documentBadgeTextUser
            : styles.documentBadgeTextAssistant,
        ]}
      >
        {attachment.fileName || 'Arriving'}
      </Text>
    </View>
  );
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
        // Announced, not yet here. Checked FIRST, before any branch that reads `uri`: a pending
        // attachment has no local file, and every branch below assumes one. The name and size come
        // from the announcement, so the row reads as the file it will become.
        attachment.pending ? (
          <ArrivingAttachment
            key={attachment.id}
            attachment={attachment}
            index={index}
            isUser={isUser}
            styles={styles}
            colors={colors}
          />
        ) : attachment.type === 'audio' ? (
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
              if (uri.startsWith('/')) {
                uri = `file://${uri}`;
              } else if (!uri.includes('://')) {
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
            imageStyle={[
              styles.attachmentImage,
              { aspectRatio: imageAspectRatio(attachment) },
            ]}
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
