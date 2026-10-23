import React from 'react';
import { View, Text, Image, TouchableOpacity, FlatList } from 'react-native';
import { LIST_CLIPPING_PROPS } from '../../constants/listClipping';
import Icon from 'react-native-vector-icons/Feather';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { CustomAlert, hideAlert } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import { GeneratedImage } from '../../types';
import { RootStackParamList } from '../../navigation/types';
import { createStyles, COLUMN_COUNT } from './styles';
import { useGalleryActions } from './useGalleryActions';
import { GalleryGridItem } from './GridItem';
import { FullscreenViewer } from './FullscreenViewer';

type GalleryScreenRouteProp = RouteProp<RootStackParamList, 'Gallery'>;

export const GalleryScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<GalleryScreenRouteProp>();
  const conversationId = route.params?.conversationId;

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

  const screenTitle = conversationId ? 'Chat Images' : 'Gallery';

  const renderGridItem = ({ item, index }: { item: GeneratedImage; index: number }) => (
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
    <SafeAreaView testID="gallery-screen" style={styles.container} edges={['top']}>
      <View style={styles.header}>
        {isSelectMode ? (
          <>
            <TouchableOpacity style={styles.closeButton} onPress={toggleSelectMode}>
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
              accessibilityLabel="Close gallery"
              accessibilityRole="button"
              style={styles.closeButton}
              onPress={() => navigation.goBack()}
            >
              <Icon name="x" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.title}>{screenTitle}</Text>
            <Text style={styles.countBadge}>{displayImages.length}</Text>
            {displayImages.length > 0 && (
              <TouchableOpacity style={styles.headerButton} onPress={toggleSelectMode}>
                <Icon name="check-square" size={20} color={colors.text} />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

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
                      { width: `${(imageGenState.progress.step / imageGenState.progress.totalSteps) * 100}%` },
                    ]}
                  />
                </View>
              )}
            </View>
            {imageGenState.progress && (
              <Text style={styles.genSteps}>
                {imageGenState.progress.step}/{imageGenState.progress.totalSteps}
              </Text>
            )}
            <TouchableOpacity style={styles.genCancelButton} onPress={handleCancelGeneration}>
              <Icon name="x" size={16} color={colors.error} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {displayImages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="image" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>
            {conversationId ? 'No images in this chat' : 'No generated images yet'}
          </Text>
          <Text style={styles.emptyText}>Generate images from any chat conversation.</Text>
        </View>
      ) : (
        <FlatList
          data={displayImages}
          renderItem={renderGridItem}
          keyExtractor={(item) => item.id}
          numColumns={COLUMN_COUNT}
          contentContainerStyle={styles.gridContainer}
          columnWrapperStyle={styles.gridRow}
          showsVerticalScrollIndicator={false}
          {...LIST_CLIPPING_PROPS}
        />
      )}

      <FullscreenViewer
        image={selectedImage}
        showDetails={showDetails}
        onClose={closeViewer}
        onToggleDetails={() => setShowDetails(prev => !prev)}
        onSave={handleSaveImage}
        onDelete={handleDelete}
      />
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </SafeAreaView>
  );
};
