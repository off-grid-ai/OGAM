import React, { useState } from 'react';
import { View, Text, Platform } from 'react-native';
import Video from 'react-native-video';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { TouchableOpacity } from '../../components/Touchable';
import { CustomAlert, hideAlert, initialAlertState, type AlertState } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import type { RootStackParamList } from '../../navigation/types';
import { resolveDocumentPath } from '../../utils/resolveDocumentPath';
import { createStyles } from './styles';
import { askDeleteVideo, saveVideo } from './galleryMedia';

type GalleryVideoRoute = RouteProp<RootStackParamList, 'GalleryVideo'>;

/** One Gallery video and its player, as its own route: Back and the swipe close it. */
export const GalleryVideoScreen: React.FC = () => {
  const navigation = useNavigation();
  const { videoId } = useRoute<GalleryVideoRoute>().params;
  const video = useAppStore(state => state.generatedVideos.find(item => item.id === videoId));
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  return (
    <SafeAreaView style={styles.container} testID="gallery-video-screen">
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="gallery-video-back"
        >
          <Icon name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Video</Text>
        {video ? (
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => { saveVideo(video, setAlertState); }}
            accessibilityRole="button"
          >
            <Text style={styles.headerButtonText}>{Platform.OS === 'ios' ? 'Share' : 'Save'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {video ? (
        <>
          <Video
            source={{ uri: `file://${resolveDocumentPath(video.videoPath)}` }}
            controls
            paused
            resizeMode="contain"
            style={[styles.videoPlayer, { aspectRatio: video.width / video.height }]}
          />
          <Text style={styles.videoPrompt}>{video.prompt}</Text>
          <TouchableOpacity
            onPress={() => askDeleteVideo(video, setAlertState, () => navigation.goBack())}
            style={styles.videoDelete}
            accessibilityRole="button"
          >
            <Text style={styles.videoDeleteText}>Delete video</Text>
          </TouchableOpacity>
        </>
      ) : (
        <Text style={styles.videoPrompt}>This video is no longer in your Gallery.</Text>
      )}
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </SafeAreaView>
  );
};
