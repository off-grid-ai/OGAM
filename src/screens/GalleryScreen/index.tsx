import { useSlot, SLOTS } from '../../bootstrap/slotRegistry';
import React, { useMemo, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { View, Text, Image, FlatList } from 'react-native';
import { TouchableOpacity } from '../../components/Touchable';
import { LIST_CLIPPING_PROPS } from '../../constants/listClipping';
import Icon from 'react-native-vector-icons/Feather';
import { AliveScreen } from '../../components/AliveScreen';
import { useNavigation, useRoute, RouteProp, type NavigationProp } from '@react-navigation/native';
import { CustomAlert, hideAlert } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import { GeneratedImage } from '../../types';
import { RootStackParamList } from '../../navigation/types';
import { useHasRegisteredScreen } from '../../navigation/screenRegistry';
import { createStyles, COLUMN_COUNT } from './styles';
import { useGalleryActions } from './useGalleryActions';
import { GalleryGridItem } from './GridItem';
import { UnderlineTabs } from '../../components/UnderlineTabs';
import { SCROLL_DEPTH_PROPS } from '../../constants/scrollDepth';

type GalleryScreenRouteProp = RouteProp<RootStackParamList, 'Gallery'>;

/** A hairline between video rows, inset to the row's text. */
const VideoDivider: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  return <View style={styles.videoDivider} />;
};

export const GalleryScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const route = useRoute<GalleryScreenRouteProp>();
  const conversationId = route.params?.conversationId;
  const [kind, setKind] = useState<'images' | 'videos'>('images');
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
    alertState,
    setAlertState,
    imageGenState,
    displayImages,
    handleRemoveUnavailable,
    toggleSelectMode,
    toggleImageSelection,
    handleDeleteSelected,
    selectAll,
    handleCancelGeneration,
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
          navigation.navigate('GalleryImage', { imageId: item.id });
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

  // The Pro library (films, clips to extend) is reached from the Videos tab, with or without Gallery clips.
  const libraryRow = hasVideoLibrary ? (
              <TouchableOpacity
                onPress={() => navigation.navigate('VideoLibrary' as never)}
                accessibilityRole="button"
                style={styles.videoRow}
                testID="gallery-open-video-library"
              >
                <Icon name="film" size={20} color={colors.textSecondary} />
                <View style={styles.videoRowBody}>
                  <Text style={styles.videoRowTitle}>Stories and clips</Text>
                  <Text style={styles.videoRowMeta}>Your films, and clips to extend</Text>
                </View>
                <Icon name="chevron-right" size={16} color={colors.textMuted} />
              </TouchableOpacity>
  ) : null;

  return (
    <AliveScreen testID="gallery-screen" style={styles.container}>
      <View style={styles.header}>
        {isSelectMode ? (
          <>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={toggleSelectMode}
              accessibilityRole="button"
              accessibilityLabel="Exit selection"
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

      <UnderlineTabs
        tabs={[
          { key: 'images' as const, label: `Images (${displayImages.length})`, testID: 'gallery-tab-images' },
          { key: 'videos' as const, label: `Videos (${displayVideos.length})`, testID: 'gallery-tab-videos' },
        ]}
        active={kind}
        onChange={tab => {
          // Leaving Images ends image select mode: the Videos list cannot show what is selected.
          if (tab === 'videos' && isSelectMode) toggleSelectMode();
          // Videos stay in Gallery and open in its viewer, like images (hand test 81). The Pro library,
          // with stories, is one row at the top of this tab rather than where the tab leads.
          setKind(tab);
        }}
      />

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
              accessibilityRole="button"
              accessibilityLabel="Stop image generation"
            >
              <Icon name="x" size={16} color={colors.error} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {kind === 'videos' ? (
        displayVideos.length === 0 ? (
          <View style={styles.videoList}>
            {/* With no clips here, the library row still leads: films may live only there. */}
            {libraryRow ? <View style={styles.videoGroup}>{libraryRow}</View> : null}
            <View style={styles.emptyContainer}>
              <Icon name="video" size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No videos in this gallery</Text>
            </View>
          </View>
        ) : (
          <FlatList
            // Its own key: the image grid has 3 columns, and a FlatList cannot change columns in place.
            key="gallery-videos"
            {...SCROLL_DEPTH_PROPS}
            data={displayVideos}
            keyExtractor={item => item.id}
            style={styles.videoList}
            contentContainerStyle={styles.videoGroup}
            ItemSeparatorComponent={VideoDivider}
            ListHeaderComponent={libraryRow}
            {...LIST_CLIPPING_PROPS}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => navigation.navigate('GalleryVideo', { videoId: item.id })}
                accessibilityRole="button"
                style={styles.videoRow}
              >
                <Icon name="play-circle" size={24} color={colors.textSecondary} />
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
          key="gallery-images"
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

      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </AliveScreen>
  );
};
