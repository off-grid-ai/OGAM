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
  useReducedMotion,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import VideoPlayer, { type VideoPlayerRef } from 'react-native-video-player';
import { ResizeMode } from 'react-native-video';
import { useTheme } from '../../../theme';
import { SPACING, TYPOGRAPHY } from '../../../constants';
import { Button } from '../../Button';
// Imported directly, not through the barrel: a component that reaches its sibling via the index
// resolves undefined at render time.
import { LoadingDots } from '../../LoadingDots';
import { MediaAttachment } from '../../../types';
import { viewDocument } from '@react-native-documents/viewer';
import logger from '../../../utils/logger';
import { resolveDocumentPath } from '../../../utils/resolveDocumentPath';

interface FadeInImageProps {
  uri: string;
  imageStyle: any;
  testID?: string;
  wrapperTestID?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}

function resolveMediaUri(uri: string): string {
  return uri.includes('/Documents/') ? `file://${resolveDocumentPath(uri)}` : uri;
}

export function FadeInImage({ uri, imageStyle, testID, wrapperTestID, onPress, accessibilityLabel }: FadeInImageProps) {
  const displayUri = resolveMediaUri(uri);
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
        disabled={!onPress}
        activeOpacity={0.8}
        accessibilityRole={onPress ? 'button' : 'image'}
        accessibilityLabel={
          accessibilityLabel ?? (isGeneratedImage ? `Generated image ${loaded ? 'loaded' : 'loading'}` : undefined)
        }
      >
        <Image
          testID={testID}
          source={{ uri: displayUri }}
          style={imageStyle}
          resizeMode="cover"
          onLoad={() => {
            setLoaded(true);
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

/** The library owns playback and controls; this adapter supplies attachment data and theme. */
function VideoAttachment({ attachment }: { attachment: MediaAttachment }) {
  const { colors } = useTheme();
  const player = React.useRef<VideoPlayerRef>(null);
  const reducedMotion = useReducedMotion();
  const [size, setSize] = React.useState({
    width: attachment.width || 16,
    height: attachment.height || 9,
  });
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <View style={{ width: '100%', gap: SPACING.xs }}>
      <VideoPlayer
        ref={player}
        preload
        source={{ uri: resolveMediaUri(attachment.uri) }}
        videoWidth={size.width}
        videoHeight={size.height}
        resizeMode={ResizeMode.CONTAIN}
        showDuration
        disableControlsAutoHide
        disableMute
        additionalControl={
          <Button
            title=""
            accessibilityLabel="Picture in picture"
            variant="ghost"
            size="small"
            disabled={!loaded}
            icon={<Icon name="minimize-2" size={SPACING.lg} color={colors.text} />}
            style={{ width: SPACING.xl * 2, height: SPACING.xl * 2, paddingHorizontal: 0 }}
            onPress={async () => {
              try {
                await player.current?.enterPictureInPicture();
              } catch {
                setError('Picture in picture is not available on this device.');
              }
            }}
          />
        }
        pauseOnPress
        animationDuration={reducedMotion ? 0 : 150}
        playInBackground
        playWhenInactive
        ignoreSilentSwitch="ignore"
        enterPictureInPictureOnLeave
        onRestoreUserInterfaceForPictureInPictureStop={() => {
          player.current?.restoreUserInterfaceForPictureInPictureStopCompleted(true);
        }}
        onLoad={({ naturalSize }) => {
          setLoaded(true);
          setError(null);
          if (naturalSize.width > 0 && naturalSize.height > 0) {
            setSize({ width: naturalSize.width, height: naturalSize.height });
          }
        }}
        onError={() => setError('This video could not be played.')}
        customStyles={{
          wrapper: { width: '100%', borderRadius: SPACING.sm, overflow: 'hidden' },
          controls: { backgroundColor: colors.surface, height: SPACING.xl * 2, marginTop: 0 },
          controlButton: { width: SPACING.xl * 2, height: SPACING.xl * 2, padding: SPACING.sm, alignItems: 'center', justifyContent: 'center' },
          controlIcon: { tintColor: colors.text, width: SPACING.lg, height: SPACING.lg },
          playArrow: { tintColor: colors.text, width: SPACING.lg, height: SPACING.lg, marginLeft: 0 },
          playButton: { backgroundColor: colors.surface, width: SPACING.xl * 2, height: SPACING.xl * 2, borderRadius: SPACING.sm },
          seekBar: { flex: 1, minWidth: 0, paddingHorizontal: SPACING.xs, marginLeft: 0, marginRight: SPACING.sm },
          seekBarProgress: { backgroundColor: colors.primary },
          seekBarKnob: { backgroundColor: colors.primary, width: SPACING.sm, height: SPACING.sm, marginHorizontal: -SPACING.xs, marginVertical: 0 },
          seekBarBackground: { backgroundColor: colors.border },
          durationText: { ...TYPOGRAPHY.meta, color: colors.textSecondary, flexShrink: 0 },
        }}
      />
      {error && <Text accessibilityRole="alert" style={{ ...TYPOGRAPHY.bodySmall, color: colors.error }}>{error}</Text>}

    </View>
  );
}

function AudioAttachment({
  index,
  isUser,
  styles,
  colors,
}: {
  index: number;
  isUser: boolean;
  styles: any;
  colors: any;
}) {
  return (
    <View
      testID={`audio-badge-${index}`}
      style={[
        styles.audioBadge,
        isUser ? styles.documentBadgeUser : styles.documentBadgeAssistant,
      ]}
    >
      <View style={styles.audioBadgeHeader}>
        <Icon name="mic" size={14} color={isUser ? colors.background : colors.textSecondary} />
        <Text
          style={[styles.documentBadgeText, isUser ? styles.documentBadgeTextUser : styles.documentBadgeTextAssistant]}
        >
          Voice message
        </Text>
      </View>
    </View>
  );
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
        color={isUser ? colors.background : colors.textSecondary}
        testID={`attachment-pending-dots-${index}`}
      />
      <Text
        numberOfLines={1}
        style={[
          styles.documentBadgeText,
          isUser ? styles.documentBadgeTextUser : styles.documentBadgeTextAssistant,
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
        ) : attachment.type === 'video' ? (
          <VideoAttachment key={attachment.id} attachment={attachment} />
        ) : attachment.type === 'audio' ? (
          <AudioAttachment
            key={attachment.id}
            index={index}
            isUser={isUser}
            styles={styles}
            colors={colors}
          />
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
            imageStyle={[
              styles.attachmentImage,
              { aspectRatio: imageAspectRatio(attachment) },
            ]}
            wrapperTestID={isUser ? `message-attachment-${index}` : 'generated-image'}
            testID={isUser ? `message-image-${index}` : 'generated-image-content'}
            onPress={() => onImagePress?.(resolveMediaUri(attachment.uri))}
          />
        )
      )}
    </View>
  );
}
