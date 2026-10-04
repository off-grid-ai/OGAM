import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { Platform, PermissionsAndroid, Share } from 'react-native';
import RNFS from 'react-native-fs';
import {
  showAlert,
  hideAlert,
  AlertState,
  initialAlertState,
} from '../../components/CustomAlert';
import { imageGenerationService } from '../../services';
import { useWorkspaceContentProjection } from '../../hooks/useApplicationProjection';
import { useGeneratedImageGalleryProjection } from '../../services/adapters/generated-image-gallery';
import {
  mobileLocalResourcePrivacy,
  removeGeneratedImage,
} from '../../services/composition/application';
import type { ImageGenerationState } from '../../services';
import { GeneratedImage } from '../../types';

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
  const generatedImages = useGeneratedImageGalleryProjection();
  const workspaceContent = useWorkspaceContentProjection();
  const privacy = useSyncExternalStore(
    mobileLocalResourcePrivacy.subscribe,
    mobileLocalResourcePrivacy.getSnapshot,
    mobileLocalResourcePrivacy.getSnapshot,
  );

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(
    null,
  );
  const [showDetails, setShowDetails] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [isDeletingOne, setIsDeletingOne] = useState(false);
  const deletionPending = useRef(false);
  const [imageGenState, setImageGenState] = useState<ImageGenerationState>(
    imageGenerationService.getState(),
  );

  useEffect(() => {
    return imageGenerationService.subscribe(state => {
      setImageGenState(state);
    });
  }, []);

  useEffect(() => {
    if (privacy.status === 'running') {
      setSelectedImage(null);
      const message =
        privacy.phase === 'release_settlement'
          ? 'Removing retained message files...'
          : privacy.phase === 'canonical_image_deletion'
          ? 'Removing gallery images and local files...'
          : 'Checking app-owned image storage...';
      setAlertState(showAlert('Deleting Images', message, []));
      return;
    }
    if (privacy.status === 'failed') {
      setAlertState(
        showAlert('Images Not Deleted', privacy.message, [
          { text: 'Close', style: 'cancel' },
          {
            text: 'Retry',
            onPress: () => {
              mobileLocalResourcePrivacy.retry().catch(error => {
                setAlertState(
                  showAlert('Images Not Deleted', deleteFailureMessage(error)),
                );
              });
            },
          },
        ]),
      );
      return;
    }
    if (privacy.status === 'completed') {
      setSelectedIds(new Set());
      setIsSelectMode(false);
      setSelectedImage(null);
      setAlertState(hideAlert());
    }
  }, [privacy]);

  /** Canonical conversation facts. Workspace Content is the single owner of title and project. */
  const conversation = useMemo(
    () =>
      conversationId
        ? workspaceContent.conversations.find(c => c.id === conversationId) ??
          null
        : null,
    [conversationId, workspaceContent.conversations],
  );

  const chatImageIds = useMemo(() => {
    if (!conversationId) return null;
    const ids = new Set<string>();
    for (const message of workspaceContent.messages) {
      if (message.conversationId !== conversationId) continue;
      const { content } = message.portable;
      if (typeof content === 'string') continue;
      for (const part of content) {
        if (part.type !== 'image') continue;
        // Legacy records carry `id`; canonical byte identity is `contentId`. Both address a gallery row.
        if (part.id) ids.add(part.id);
        if (part.contentId) ids.add(part.contentId);
      }
    }
    return ids;
  }, [conversationId, workspaceContent.messages]);

  const displayImages = useMemo(() => {
    if (!conversationId) return generatedImages;
    return generatedImages.filter(
      img =>
        img.conversationId === conversationId ||
        (chatImageIds && chatImageIds.has(img.id)),
    );
  }, [generatedImages, conversationId, chatImageIds]);

  const deleteFailureMessage = (error: unknown): string =>
    error instanceof Error
      ? error.message
      : 'The image deletion did not settle.';

  const handleDelete = useCallback(
    (image: GeneratedImage) => {
      const doDelete = async () => {
        if (deletionPending.current || privacy.status === 'running') return;
        deletionPending.current = true;
        setIsDeletingOne(true);
        setAlertState(
          showAlert(
            'Deleting Image',
            'Removing the image and its local file...',
            [],
          ),
        );
        try {
          await removeGeneratedImage(image.id);
          if (selectedImage?.id === image.id) setSelectedImage(null);
          setAlertState(hideAlert());
        } catch (error) {
          setAlertState(
            showAlert('Image Not Deleted', deleteFailureMessage(error)),
          );
        } finally {
          deletionPending.current = false;
          setIsDeletingOne(false);
        }
      };
      setAlertState(
        showAlert(
          'Delete Image',
          'Are you sure you want to delete this image?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                doDelete();
              },
            },
          ],
        ),
      );
    },
    [privacy.status, selectedImage],
  );

  const handleDeleteAll = useCallback(() => {
    if (privacy.status === 'running') return;
    setAlertState(
      showAlert(
        'Delete All Images',
        'Delete every gallery image and its local file?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete All',
            style: 'destructive',
            onPress: () => {
              mobileLocalResourcePrivacy.execute('images').catch(error => {
                setAlertState(
                  showAlert('Images Not Deleted', deleteFailureMessage(error)),
                );
              });
            },
          },
        ],
      ),
    );
  }, [privacy.status]);

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
    if (selectedIds.size === 0 || privacy.status === 'running') return;
    const count = selectedIds.size;
    setAlertState(
      showAlert(
        'Delete Images',
        `Are you sure you want to delete ${count} image${
          count > 1 ? 's' : ''
        }?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              const doDeleteSelected = async () => {
                if (deletionPending.current) return;
                deletionPending.current = true;
                setIsDeletingOne(true);
                setAlertState(
                  showAlert(
                    'Deleting Images',
                    `Removing ${count} image${
                      count > 1 ? 's' : ''
                    } and local files...`,
                    [],
                  ),
                );
                try {
                  for (const imageId of selectedIds) {
                    await removeGeneratedImage(imageId);
                  }
                  setSelectedIds(new Set());
                  setIsSelectMode(false);
                  setAlertState(hideAlert());
                } catch (error) {
                  setAlertState(
                    showAlert(
                      'Images Not Deleted',
                      deleteFailureMessage(error),
                    ),
                  );
                } finally {
                  deletionPending.current = false;
                  setIsDeletingOne(false);
                }
              };
              doDeleteSelected();
            },
          },
        ],
      ),
    );
  }, [privacy.status, selectedIds]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(displayImages.map(img => img.id)));
  }, [displayImages]);

  const handleSaveImage = useCallback(async (image: GeneratedImage) => {
    try {
      if (Platform.OS === 'ios') {
        await Share.share({ url: `file://${image.imagePath}` });
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
        },
      );
      const picturesDir = `${RNFS.ExternalStorageDirectoryPath}/Pictures/OffgridMobile`;
      if (!(await RNFS.exists(picturesDir))) {
        await RNFS.mkdir(picturesDir);
      }
      const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
      const fileName = `generated_${timestamp}.png`;
      await RNFS.copyFile(image.imagePath, `${picturesDir}/${fileName}`);
      setAlertState(
        showAlert('Image Saved', `Saved to Pictures/OffgridMobile/${fileName}`),
      );
    } catch (error: any) {
      setAlertState(
        showAlert(
          'Error',
          `Failed to save image: ${error?.message || 'Unknown error'}`,
        ),
      );
    }
  }, []);

  const handleCancelGeneration = useCallback(() => {
    imageGenerationService.cancelGeneration().catch(() => {});
  }, []);

  const closeViewer = useCallback(() => {
    setSelectedImage(null);
    setShowDetails(false);
  }, []);

  const dismissAlert = useCallback(() => {
    if (!deletionPending.current && privacy.status !== 'running')
      setAlertState(hideAlert());
  }, [privacy.status]);

  return {
    isSelectMode,
    selectedIds,
    selectedImage,
    setSelectedImage,
    showDetails,
    setShowDetails,
    alertState,
    isDeleting: isDeletingOne || privacy.status === 'running',
    privacyRunning: privacy.status === 'running',
    dismissAlert,
    setAlertState,
    imageGenState,
    displayImages,
    conversationTitle: conversation?.title ?? null,
    conversationProjectId: conversation?.projectId ?? null,
    handleDelete,
    handleDeleteAll,
    toggleSelectMode,
    toggleImageSelection,
    handleDeleteSelected,
    selectAll,
    handleSaveImage,
    handleCancelGeneration,
    closeViewer,
  };
};
