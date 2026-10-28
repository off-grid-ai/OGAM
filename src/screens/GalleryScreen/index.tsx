import { exportGeneratedMedia } from '../../services/exportGeneratedMedia';
import { deleteGeneratedVideo } from '../../services/generatedVideoFiles';
import { useSlot, SLOTS } from '../../bootstrap/slotRegistry';
import React, { useMemo, useState } from 'react';
import { Modal } from 'react-native';
import Video from 'react-native-video';
import { useAppStore } from '../../stores/appStore';
import { resolveDocumentPath } from '../../utils/resolveDocumentPath';
import type { GeneratedVideo } from '../../types';
import { View, Text, Image, TouchableOpacity, FlatList, Platform } from 'react-native';
import { LIST_CLIPPING_PROPS } from '../../constants/listClipping';
import Icon from 'react-native-vector-icons/Feather';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { CustomAlert, hideAlert, showAlert, type AlertState } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import { GeneratedImage } from '../../types';
import { RootStackParamList } from '../../navigation/types';
import { useHasRegisteredScreen } from '../../navigation/screenRegistry';
import { createStyles, COLUMN_COUNT } from './styles';
import { useGalleryActions } from './useGalleryActions';
import { GalleryGridItem } from './GridItem';
import { FullscreenViewer } from './FullscreenViewer';

type GalleryScreenRouteProp = RouteProp<RootStackParamList, 'Gallery'>;

/** The alert, shown only in the place it belongs: over the open video, or over the Gallery. */
const shownWhere = (state: AlertState, here: boolean): AlertState => ({ ...state, visible: state.visible && here });

/** Deleting a video asks first, as the Studio's viewer does; a failure says so in the same sheet. */
function askDeleteVideo(videoId: string, setAlertState: (state: AlertState) => void, onDeleted: () => void): void {
  setAlertState(
    showAlert('Delete this video?', 'It is removed from this phone and its chat.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteGeneratedVideo(videoId)
            .then(onDeleted)
            .catch(error => setAlertState(showAlert('Could not delete video', String(error.message))));
        },
      },
    ]),
  );
}

export const GalleryScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<GalleryScreenRouteProp>();
  const conversationId = route.params?.conversationId;
  const [kind, setKind] = useState<'images' | 'videos'>('images');
  const [selectedVideo, setSelectedVideo] = useState<GeneratedVideo | null>(null);
  const videos = useAppStore(state => state.generatedVideos);
  // Video is Pro: making and tracking videos fills these slots. Watching saved videos stays free.
  const VideoStatus = useSlot(SLOTS.videoStatus);
  const VideoSection = useSlot(SLOTS.galleryVideoSection);
  // With Pro, videos have their own Library route (stories and clips); without it, this tab lists them.
  const hasVideoLibrary = useHasRegisteredScreen('VideoLibrary');
  const displayVideos = useMemo(
    () =>
      conversationId
        ? videos.filter(video => video.conversationId === conversationId)
        : videos,
    [videos, conversationId],
  );

  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const {
    isSelectMode,
    selectedIds,
    selectedImage,
    setSelectedImage,
    showDetails,
    setShowDetails,
    alertState,
    setAlertState,
    imageGenState,
    displayImages,
    handleDelete,
    handleRemoveUnavailable,
    toggleSelectMode,
    toggleImageSelection,
    handleDeleteSelected,
    selectAll,
    handleSaveImage,
    handleCancelGeneration,
    closeViewer,
  } = useGalleryActions(conversationId);

  const screenTitle = conversationId ? 'Chat Media' : 'Gallery';

  const renderGridItem = ({
    item,
    index,
  }: {
    item: GeneratedImage;
    index: number;
  }) => (
    <GalleryGridItem
      item={item}
      index={index}
      isSelectMode={isSelectMode}
      isSelected={selectedIds.has(item.id)}
      onPress={() => {
        if (isSelectMode) {
          toggleImageSelection(item.id);
        } else {
          setSelectedImage(item);
        }
      }}
      onRemove={() => handleRemoveUnavailable(item)}
      onLongPress={() => {
        if (!isSelectMode) {
          toggleSelectMode();
          toggleImageSelection(item.id);
        }
      }}
    />
  );

  return (
    <SafeAreaView
      testID="gallery-screen"
      style={styles.container}
      edges={['top']}
    >
      <View style={styles.header}>
        {isSelectMode ? (
          <>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={toggleSelectMode}
            >
              <Icon name="x" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.title}>{selectedIds.size} selected</Text>
            <TouchableOpacity style={styles.headerButton} onPress={selectAll}>
              <Text style={styles.headerButtonText}>All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.headerButton, selectedIds.size === 0 && styles.headerButtonDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Delete selected images"
              onPress={handleDeleteSelected}
              disabled={selectedIds.size === 0}
            >
              <Icon
                name="trash-2"
                size={20}
                color={selectedIds.size === 0 ? colors.textMuted : colors.error}
              />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              accessibilityLabel="Back"
              accessibilityRole="button"
              testID="gallery-back"
              style={styles.closeButton}
              onPress={() => navigation.goBack()}
            >
              <Icon name="arrow-left" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.title}>{screenTitle}</Text>
            <Text style={styles.countBadge}>{kind === 'images' ? displayImages.length : displayVideos.length}</Text>
            {/* Select mode picks images only, so it is offered on the Images tab alone. */}
            {kind === 'images' && displayImages.length > 0 && (
              <TouchableOpacity
                style={styles.headerButton}
                onPress={toggleSelectMode}
                accessibilityRole="button"
                accessibilityLabel="Select images"
                testID="gallery-select"
              >
                <Icon name="check-square" size={20} color={colors.text} />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      <View style={styles.mediaTabs}>
        {(['images', 'videos'] as const).map(tab => <TouchableOpacity key={tab} onPress={() => {
          // Leaving Images ends image select mode: the Videos list cannot show what is selected.
          if (tab === 'videos' && isSelectMode) toggleSelectMode();
          if (tab === 'videos' && hasVideoLibrary) navigation.navigate('VideoLibrary' as never);
          else setKind(tab);
        }} accessibilityRole="button" testID={`gallery-tab-${tab}`}
          style={[styles.mediaTab, kind === tab && styles.mediaTabActive]}>
          <Text style={kind === tab ? styles.mediaTabTextActive : styles.mediaTabText}>{tab === 'images' ? `Images (${displayImages.length})` : `Videos (${displayVideos.length})`}</Text>
        </TouchableOpacity>)}
      </View>

      {kind === 'videos' && VideoStatus && (
        <VideoStatus conversationId={conversationId} />
      )}
      {kind === 'videos' && VideoSection && !conversationId && <VideoSection />}
      {imageGenState.isGenerating && (
        <View style={styles.genBanner}>
          <View style={styles.genBannerRow}>
            {imageGenState.previewPath && (
              <Image
                source={{ uri: imageGenState.previewPath }}
                style={styles.genPreview}
                resizeMode="cover"
              />
            )}
            <View style={styles.genBannerInfo}>
              <Text style={styles.genBannerTitle} numberOfLines={1}>
                {imageGenState.previewPath ? 'Refining...' : 'Generating...'}
              </Text>
              <Text style={styles.genBannerPrompt} numberOfLines={1}>
                {imageGenState.prompt}
              </Text>
              {imageGenState.progress && (
                <View style={styles.genProgressBar}>
                  <View
                    style={[
                      styles.genProgressFill,
                      {
                        width: `${(imageGenState.progress.step / imageGenState.progress.totalSteps) * 100}%`,
                      },
                    ]}
                  />
                </View>
              )}
            </View>
            {imageGenState.progress && (
              <Text style={styles.genSteps}>
                {imageGenState.progress.step}/
                {imageGenState.progress.totalSteps}
              </Text>
            )}
            <TouchableOpacity
              style={styles.genCancelButton}
              onPress={handleCancelGeneration}
            >
              <Icon name="x" size={16} color={colors.error} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {kind === 'videos' ? (
        displayVideos.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Icon name="video" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No videos in this gallery</Text>
          </View>
        ) : (
          <FlatList
            data={displayVideos}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.videoList}
            {...LIST_CLIPPING_PROPS}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => setSelectedVideo(item)}
                accessibilityRole="button"
                style={styles.videoRow}
              >
                <Icon name="play-circle" size={28} color={colors.primary} />
                <View style={styles.videoRowBody}>
                  <Text numberOfLines={2} style={styles.videoRowTitle}>
                    {item.prompt}
                  </Text>
                  <Text style={styles.videoRowMeta}>
                    {item.durationSeconds.toFixed(1)} s · {item.width} ×{' '}
                    {item.height}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        )
      ) : displayImages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="image" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>
            {conversationId
              ? 'No images in this chat'
              : 'No generated images yet'}
          </Text>
          <Text style={styles.emptyText}>
            Generate images from any chat conversation.
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayImages}
          renderItem={renderGridItem}
          keyExtractor={item => item.id}
          numColumns={COLUMN_COUNT}
          contentContainerStyle={styles.gridContainer}
          columnWrapperStyle={styles.gridRow}
          showsVerticalScrollIndicator={false}
          {...LIST_CLIPPING_PROPS}
        />
      )}

      <Modal
        visible={!!selectedVideo}
        animationType="slide"
        onRequestClose={() => setSelectedVideo(null)}
      >
        <SafeAreaView style={styles.container}>
          <View style={styles.videoViewerHeader}>
            <TouchableOpacity onPress={() => setSelectedVideo(null)}>
              <Text style={styles.videoViewerText}>Close</Text>
            </TouchableOpacity>
            {selectedVideo ? (
              <TouchableOpacity
                onPress={() => {
                  void exportGeneratedMedia(
                    selectedVideo.videoPath,
                    `${selectedVideo.id}.mp4`,
                    'video/mp4',
                  )
                    .then(() => {
                      if (Platform.OS === 'android')
                        setAlertState(showAlert('Saved to Downloads'));
                    })
                    .catch(error =>
                      setAlertState(
                        showAlert('Save failed', String(error.message)),
                      ),
                    );
                }}
              >
                <Text style={{ color: colors.primary }}>
                  {Platform.OS === 'ios' ? 'Share' : 'Save'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {selectedVideo ? (
            <>
              <Video
                source={{
                  uri: `file://${resolveDocumentPath(selectedVideo.videoPath)}`,
                }}
                controls
                paused
                resizeMode="contain"
                style={[
                  styles.videoPlayer,
                  { aspectRatio: selectedVideo.width / selectedVideo.height },
                ]}
              />
              <Text style={styles.videoPrompt}>
                {selectedVideo.prompt}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  askDeleteVideo(selectedVideo.id, setAlertState, () => setSelectedVideo(null))
                }
                style={styles.videoDelete}
              >
                <Text style={styles.videoDeleteText}>Delete video</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </SafeAreaView>
        {/* Inside the video's Modal, so its sheet shows above the video, not behind it. */}
        <CustomAlert {...shownWhere(alertState, !!selectedVideo)} onClose={() => setAlertState(hideAlert())} />
      </Modal>
      <FullscreenViewer
        image={selectedImage}
        showDetails={showDetails}
        onClose={closeViewer}
        onToggleDetails={() => setShowDetails(prev => !prev)}
        onSave={handleSaveImage}
        onDelete={handleDelete}
      />
      <CustomAlert {...shownWhere(alertState, !selectedVideo)} onClose={() => setAlertState(hideAlert())} />
    </SafeAreaView>
  );
};
