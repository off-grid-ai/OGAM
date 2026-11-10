import { useState, useEffect, useCallback, useMemo } from 'react';
import { showAlert, hideAlert, AlertState, initialAlertState } from '../../components/CustomAlert';
import { useAppStore, useChatStore } from '../../stores';
import { imageGenerationService, onnxImageGeneratorService } from '../../services';
import type { ImageGenerationState } from '../../services';
import { GeneratedImage } from '../../types';
import { deleteGalleryImage } from './galleryMedia';

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

  const handleRemoveUnavailable = useCallback((image: GeneratedImage) => {
    setAlertState(showAlert(
      'Remove Image',
      'Remove this image record from your Gallery?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          removeGeneratedImage(image.id);
          setAlertState(hideAlert());
        } },
      ],
    ));
  }, [removeGeneratedImage]);

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
              let notDeleted = 0;
              for (const image of selectedImages) {
                if (!(await deleteGalleryImage(image))) notDeleted += 1;
              }
              setSelectedIds(new Set());
              setIsSelectMode(false);
              if (notDeleted > 0) {
                setAlertState(showAlert(
                  'Some images were not deleted',
                  `${notDeleted} ${notDeleted === 1 ? 'image' : 'images'} could not be removed. ${notDeleted === 1 ? 'Its record is' : 'Their records are'} still in your Gallery.`,
                ));
              }
            };
            doDeleteSelected();
          },
        },
      ]
    ));
  }, [selectedIds, displayImages]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(displayImages.map(img => img.id)));
  }, [displayImages]);

  const handleCancelGeneration = useCallback(() => {
    imageGenerationService.cancelGeneration().catch(() => {});
  }, []);

  return {
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
  };
};
