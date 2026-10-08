import { useState, useEffect, useCallback, useMemo } from 'react';
import { Platform, PermissionsAndroid, Share } from 'react-native';
import RNFS from 'react-native-fs';
import { showAlert, hideAlert, AlertState, initialAlertState } from '../../components/CustomAlert';
import { useAppStore, useChatStore } from '../../stores';
import { imageGenerationService, onnxImageGeneratorService } from '../../services';
import type { ImageGenerationState } from '../../services';
import { GeneratedImage } from '../../types';
import { resolveDocumentPath } from '../../utils/resolveDocumentPath';

export const formatDate = (dateStr: string): string => {
  const ts = Number(dateStr);
  const date = Number.isNaN(ts) ? new Date(dateStr) : new Date(ts);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const useGalleryActions = (conversationId: string | undefined) => {
  const { generatedImages, removeGeneratedImage } = useAppStore();
  const conversations = useChatStore(s => s.conversations);

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [imageGenState, setImageGenState] = useState<ImageGenerationState>(
    imageGenerationService.getState()
  );

  useEffect(() => {
    return imageGenerationService.subscribe((state) => {
      setImageGenState(state);
    });
  }, []);

  useEffect(() => {
    const syncFromDisk = async () => {
      try {
        const diskImages = await onnxImageGeneratorService.getGeneratedImages();
        if (diskImages.length > 0) {
          const { generatedImages: storeImages, addGeneratedImage } = useAppStore.getState();
          const existingIds = new Set(storeImages.map(img => img.id));
          for (const img of diskImages) {
            if (!existingIds.has(img.id)) {
              addGeneratedImage(img);
            }
          }
        }
      } catch {
        // Silently fail
      }
    };
    syncFromDisk();
  }, []);

  const chatImageIds = useMemo(() => {
    if (!conversationId) return null;
    const convo = conversations.find(c => c.id === conversationId);
    if (!convo) return new Set<string>();
    const ids = new Set<string>();
    for (const msg of convo.messages) {
      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (att.type === 'image') ids.add(att.id);
        }
      }
    }
    return ids;
  }, [conversationId, conversations]);

  const displayImages = useMemo(() => {
    if (!conversationId) return generatedImages;
    return generatedImages.filter(
      img => img.conversationId === conversationId || (chatImageIds && chatImageIds.has(img.id))
    );
  }, [generatedImages, conversationId, chatImageIds]);

  const handleDelete = useCallback((image: GeneratedImage) => {
    const doDelete = async () => {
      setAlertState(hideAlert());
      const deleted = await onnxImageGeneratorService.deleteGeneratedImage(
        image.id,
        image.imagePath,
      );
      if (deleted) {
        removeGeneratedImage(image.id);
        if (selectedImage?.id === image.id) setSelectedImage(null);
      }
    };
    setAlertState(showAlert(
      'Delete Image',
      'Are you sure you want to delete this image?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => { doDelete(); },
        },
      ]
    ));
  }, [selectedImage, removeGeneratedImage]);

  const toggleSelectMode = useCallback(() => {
    setIsSelectMode(prev => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  const toggleImageSelection = useCallback((imageId: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(imageId)) {
        newSet.delete(imageId);
      } else {
        newSet.add(imageId);
      }
      return newSet;
    });
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    setAlertState(showAlert(
      'Delete Images',
      `Are you sure you want to delete ${count} image${count > 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const doDeleteSelected = async () => {
              setAlertState(hideAlert());
              const selectedImages = displayImages.filter(image => selectedIds.has(image.id));
              for (const image of selectedImages) {
                const deleted = await onnxImageGeneratorService.deleteGeneratedImage(
                  image.id,
                  image.imagePath,
                );
                if (deleted) removeGeneratedImage(image.id);
              }
              setSelectedIds(new Set());
              setIsSelectMode(false);
            };
            doDeleteSelected();
          },
        },
      ]
    ));
  }, [selectedIds, displayImages, removeGeneratedImage]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(displayImages.map(img => img.id)));
  }, [displayImages]);

  const handleSaveImage = useCallback(async (image: GeneratedImage) => {
    try {
      const imagePath = resolveDocumentPath(image.imagePath);
      if (Platform.OS === 'ios') {
        await Share.share({ url: `file://${imagePath}` });
        return;
      }
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
        {
          title: 'Storage Permission',
          message: 'App needs access to save images',
          buttonNeutral: 'Ask Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      const picturesDir = `${RNFS.ExternalStorageDirectoryPath}/Pictures/OffgridMobile`;
      if (!(await RNFS.exists(picturesDir))) {
        await RNFS.mkdir(picturesDir);
      }
      const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
      const fileName = `generated_${timestamp}.png`;
      await RNFS.copyFile(imagePath, `${picturesDir}/${fileName}`);
      setAlertState(showAlert('Image Saved', `Saved to Pictures/OffgridMobile/${fileName}`));
    } catch (error: any) {
      setAlertState(showAlert('Error', `Failed to save image: ${error?.message || 'Unknown error'}`));
    }
  }, []);

  const handleCancelGeneration = useCallback(() => {
    imageGenerationService.cancelGeneration().catch(() => {});
  }, []);

  const closeViewer = useCallback(() => {
    setSelectedImage(null);
    setShowDetails(false);
  }, []);

  return {
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
    toggleSelectMode,
    toggleImageSelection,
    handleDeleteSelected,
    selectAll,
    handleSaveImage,
    handleCancelGeneration,
    closeViewer,
  };
};
