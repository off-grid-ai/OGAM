import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StatusBar, Platform } from 'react-native';
import Video from 'react-native-video';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { TouchableOpacity } from '../../components/Touchable';
import { AppSheet } from '../../components/AppSheet';
import { CustomAlert, hideAlert, initialAlertState, type AlertState } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import type { RootStackParamList } from '../../navigation/types';
import { resolveDocumentPath } from '../../utils/resolveDocumentPath';
import { createStyles, VIEWER_INK } from './styles';
import { formatDate } from './useGalleryActions';
import { askDeleteVideo, saveVideo } from './galleryMedia';

type GalleryVideoRoute = RouteProp<RootStackParamList, 'GalleryVideo'>;

/**
 * One Gallery video, full screen, as its own route: Back and the swipe close it. Its actions and details
 * sit in a sheet opened by More, the same as an image (hand test 81: Share in the header and a red
 * "Delete video" link on the page read as a different screen).
 */
export const GalleryVideoScreen: React.FC = () => {
  const navigation = useNavigation();
  const { videoId } = useRoute<GalleryVideoRoute>().params;
  const video = useAppStore(state => state.generatedVideos.find(item => item.id === videoId));
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { top } = useSafeAreaInsets();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  // Delete's confirmation opens once the sheet has fully closed, so two sheets never meet mid-dismiss.
  const afterClose = useRef<(() => void) | null>(null);
  const closeSheetThen = (action: () => void) => {
    afterClose.current = action;
    setSheetOpen(false);
  };
  const runAfterClose = () => {
    const action = afterClose.current;
    afterClose.current = null;
    action?.();
  };

  return (
    <View style={styles.imageScreen} testID="gallery-video-screen">
      <StatusBar barStyle="light-content" />
      {video ? (
        <View style={styles.imageScreenPicture}>
          <Video
            source={{ uri: `file://${resolveDocumentPath(video.videoPath)}` }}
            controls
            paused
            resizeMode="contain"
            style={[styles.videoPlayer, { aspectRatio: video.width / video.height }]}
            accessibilityLabel={video.prompt}
          />
        </View>
      ) : (
        <Text style={styles.imageScreenGone}>This video is no longer in your Gallery.</Text>
      )}
      <View style={[styles.imageScreenBar, { paddingTop: top }]}>
        <TouchableOpacity
          style={styles.imageScreenBarButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="gallery-video-back"
        >
          <Icon name="arrow-left" size={24} color={VIEWER_INK} />
        </TouchableOpacity>
        {video ? (
          <TouchableOpacity
            style={styles.imageScreenBarButton}
            onPress={() => setSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Details and actions"
            testID="gallery-video-more"
          >
            <Icon name="more-horizontal" size={24} color={VIEWER_INK} />
          </TouchableOpacity>
        ) : null}
      </View>

      {video ? (
        <AppSheet
          sheet="gallery-video"
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onClosed={runAfterClose}
          enableDynamicSizing
          title="Video"
        >
          <View style={styles.imageSheetActions}>
            <TouchableOpacity
              style={styles.imageSheetAction}
              // Over the open sheet: iOS presents the share sheet from it.
              onPress={() => { saveVideo(video, setAlertState).catch(() => { /* it shows its own alert */ }); }}
              accessibilityRole="button"
              accessibilityLabel={Platform.OS === 'ios' ? 'Share' : 'Save'}
              testID="gallery-video-save"
            >
              <Icon name={Platform.OS === 'ios' ? 'share' : 'download'} size={22} color={colors.text} />
              <Text style={styles.imageSheetActionText}>{Platform.OS === 'ios' ? 'Share' : 'Save'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.imageSheetAction}
              onPress={() => closeSheetThen(() => askDeleteVideo(video, setAlertState, () => navigation.goBack()))}
              accessibilityRole="button"
              accessibilityLabel="Delete"
              testID="gallery-video-delete"
            >
              <Icon name="trash-2" size={22} color={colors.error} />
              <Text style={[styles.imageSheetActionText, styles.imageSheetActionDestructive]}>Delete</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.detailsContent}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>PROMPT</Text>
              <Text style={styles.detailValue}>{video.prompt}</Text>
            </View>
            <View style={styles.detailsMetaRow}>
              <View style={styles.detailChip}>
                <Text style={styles.detailChipText}>{video.width}x{video.height}</Text>
              </View>
              <View style={styles.detailChip}>
                <Text style={styles.detailChipText}>{video.frames} frames</Text>
              </View>
              <View style={styles.detailChip}>
                <Text style={styles.detailChipText}>{video.durationSeconds.toFixed(1)}s</Text>
              </View>
            </View>
            <Text style={styles.detailDate}>{formatDate(video.createdAt)}</Text>
          </ScrollView>
        </AppSheet>
      ) : null}
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </View>
  );
};
