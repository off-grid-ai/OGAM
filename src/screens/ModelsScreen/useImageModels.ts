import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { AlertState } from '../../components/CustomAlert';
import { useAppStore } from '../../stores';
import { useDownloadStore } from '../../stores/downloadStore';
import { makeImageModelKey } from '../../utils/modelKey';
import {
  modelManager,
  hardwareService,
  backgroundDownloadService,
} from '../../services';
import {
  fetchAvailableModels,
  HFImageModel,
  guessStyle,
} from '../../services/huggingFaceModelBrowser';
import { fetchAvailableCoreMLModels } from '../../services/coreMLModelBrowser';
import { ImageModelRecommendation } from '../../types';
import {
  BackendFilter,
  ImageFilterDimension,
  ImageModelDescriptor,
} from './types';
import { matchesSdVersionFilter } from './utils';
import {
  ImageDownloadDeps,
  handleDownloadImageModel as downloadImageModel,
  cancelSyntheticImageDownload,
} from './imageDownloadActions';
import { isLiveImageFinalization } from './imageZipFinalization';
import { resumeImageDownload } from './imageDownloadResume';

export function useImageModels(setAlertState: (s: AlertState) => void) {
  const [availableHFModels, setAvailableHFModels] = useState<HFImageModel[]>(
    [],
  );
  const [hfModelsLoading, setHfModelsLoading] = useState(false);
  const [hfModelsError, setHfModelsError] = useState<string | null>(null);
  const [backendFilter, setBackendFilter] = useState<BackendFilter>('all');
  const [styleFilter, setStyleFilter] = useState<string>('all');
  const [sdVersionFilter, setSdVersionFilter] = useState<string>('all');
  const [imageFilterExpanded, setImageFilterExpanded] =
    useState<ImageFilterDimension>(null);
  const [imageSearchQuery, setImageSearchQuery] = useState('');
  const [imageFiltersVisible, setImageFiltersVisible] = useState(false);
  const [imageRec, setImageRec] = useState<ImageModelRecommendation | null>(
    null,
  );
  const [userChangedBackendFilter, setUserChangedBackendFilter] =
    useState(false);
  const [showRecommendedOnly, setShowRecommendedOnly] = useState(true);
  const [showRecHint, setShowRecHint] = useState(true);

  const {
    downloadedImageModels,
    setDownloadedImageModels,
    addDownloadedImageModel,
    activeImageModelId,
    setActiveImageModelId,
    onboardingChecklist,
  } = useAppStore();
  const downloads = useDownloadStore(s => s.downloads);
  const resumingDownloadKeysRef = useRef<Set<string>>(new Set());

  const makeDeps = (): ImageDownloadDeps => ({
    addDownloadedImageModel,
    activeImageModelId,
    setActiveImageModelId,
    setAlertState,
    triedImageGen: onboardingChecklist.triedImageGen,
  });

  const loadDownloadedImageModels = useCallback(async () => {
    const models = await modelManager.getDownloadedImageModels();
    setDownloadedImageModels(models);
  }, [setDownloadedImageModels]);

  const loadHFModels = useCallback(async (forceRefresh = false) => {
    setHfModelsLoading(true);
    setHfModelsError(null);
    try {
      if (Platform.OS === 'ios') {
        const coremlModels = await fetchAvailableCoreMLModels(forceRefresh);
        setAvailableHFModels(
          coremlModels.map(m => ({
            id: m.id,
            name: m.name,
            displayName: m.displayName,
            backend: 'coreml' as any,
            fileName: m.fileName,
            downloadUrl: m.downloadUrl,
            size: m.size,
            repo: m.repo,
            _coreml: true,
            _coremlFiles: m.files,
            _coremlAttentionVariant: m.attentionVariant,
          })),
        );
      } else {
        const socInfo = await hardwareService.getSoCInfo();
        setAvailableHFModels(
          await fetchAvailableModels(forceRefresh, {
            skipQnn: !socInfo.hasNPU,
          }),
        );
      }
    } catch (error: any) {
      setHfModelsError(error?.message || 'Failed to fetch models');
    } finally {
      setHfModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const downloaded = await modelManager.getDownloadedImageModels();
      setDownloadedImageModels(downloaded);
    };
    init();
  }, [setDownloadedImageModels]);

  useEffect(() => {
    const processingEntries = Object.values(downloads).filter(
      entry => entry.modelType === 'image' && entry.status === 'processing',
    );
    if (processingEntries.length === 0) return;

    let cancelled = false;
    const resumeProcessingDownloads = async () => {
      const latestDownloaded = await modelManager.getDownloadedImageModels();
      if (cancelled) return;
      const downloadedIds = new Set(latestDownloaded.map(m => m.id));
      const deps = makeDeps();

      for (const entry of processingEntries) {
        if (cancelled) return;
        if (resumingDownloadKeysRef.current.has(entry.modelKey)) continue;
        // A same-session native completion already owns unzip/register. Recovery is
        // only the fallback owner after a real restart (the transient ownership set
        // is then empty); running both can register a model before unzip resolves.
        if (isLiveImageFinalization(entry.modelKey)) continue;

        const modelId = entry.modelId.replace('image:', '');
        if (downloadedIds.has(modelId)) {
          useDownloadStore.getState().remove(entry.modelKey);
          continue;
        }

        // Restored image downloads can finish after mount and transition
        // running -> processing via the global download hook. Re-run the same
        // finalize path here so unzip/register isn't missed after relaunch.
        resumingDownloadKeysRef.current.add(entry.modelKey);
        resumeImageDownload(entry, deps)
          .catch(() => {})
          .finally(() => {
            resumingDownloadKeysRef.current.delete(entry.modelKey);
          });
      }
    };

    resumeProcessingDownloads();
    return () => {
      cancelled = true;
    };
    // makeDeps intentionally omitted: it is recreated each render and current store
    // values are read when resumeProcessingDownloads runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloads]);

  useEffect(() => {
    let cancelled = false;
    hardwareService.getImageModelRecommendation().then(rec => {
      if (cancelled) return;
      setImageRec(rec);
      if (!userChangedBackendFilter && Platform.OS !== 'ios') {
        let filter: 'qnn' | 'mnn' | 'all';
        if (rec.recommendedBackend === 'qnn') filter = 'qnn';
        else if (rec.recommendedBackend === 'mnn') filter = 'mnn';
        else filter = 'all';
        setBackendFilter(filter);
      }
    });
    return () => {
      cancelled = true;
    };

    // Intentionally mount-only: fetches hardware recommendation once.
    // userChangedBackendFilter is read inside but should not re-trigger this fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearImageFilters = useCallback(() => {
    setBackendFilter('all');
    setUserChangedBackendFilter(true);
    setStyleFilter('all');
    setSdVersionFilter('all');
    setImageFilterExpanded(null);
  }, []);

  const isRecommendedModel = useCallback(
    (model: HFImageModel): boolean => {
      if (!imageRec) return false;
      if (
        model.backend !== imageRec.recommendedBackend &&
        imageRec.recommendedBackend !== 'all'
      )
        return false;
      if (imageRec.qnnVariant && model.variant)
        return model.variant.includes(imageRec.qnnVariant);
      if (imageRec.recommendedModels?.length) {
        const fields = [model.name, model.repo, model.id].map(s =>
          s.toLowerCase(),
        );
        return imageRec.recommendedModels.some(p =>
          fields.some(f => f.includes(p)),
        );
      }
      return true;
    },
    [imageRec],
  );

  const filteredHFModels = useMemo(() => {
    const query = imageSearchQuery.toLowerCase().trim();
    const filtered = availableHFModels.filter(m => {
      const hiddenByRecommendation =
        showRecommendedOnly && imageRec && !isRecommendedModel(m);
      const hiddenByBackend =
        backendFilter !== 'all' && m.backend !== backendFilter;
      const hiddenByStyle =
        styleFilter !== 'all' && guessStyle(m.name) !== styleFilter;
      const hiddenByVersion = !matchesSdVersionFilter(m.name, sdVersionFilter);
      const alreadyDownloaded = downloadedImageModels.some(d => d.id === m.id);
      const hiddenByQuery =
        query &&
        !m.displayName.toLowerCase().includes(query) &&
        !m.name.toLowerCase().includes(query);
      return !(
        hiddenByRecommendation ||
        hiddenByBackend ||
        hiddenByStyle ||
        hiddenByVersion ||
        alreadyDownloaded ||
        hiddenByQuery
      );
    });
    if (!showRecommendedOnly)
      filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return filtered;
  }, [
    availableHFModels,
    backendFilter,
    styleFilter,
    sdVersionFilter,
    downloadedImageModels,
    imageSearchQuery,
    imageRec,
    isRecommendedModel,
    showRecommendedOnly,
  ]);

  const hasActiveImageFilters =
    backendFilter !== 'all' ||
    styleFilter !== 'all' ||
    sdVersionFilter !== 'all';
  const imageRecommendation =
    imageRec?.bannerText ?? 'Loading recommendation...';

  const handleDownloadImageModel = (modelInfo: ImageModelDescriptor) =>
    downloadImageModel(modelInfo, makeDeps());

  // Cancel by reading the store entry's downloadId; for synthetic multifile
  // ids the native cancel is a no-op (downloadFileTo is in-process), but
  // the store remove is what matters for UI.
  const handleCancelImageDownload = async (modelId: string) => {
    const modelKey = makeImageModelKey(modelId);
    const entry = useDownloadStore.getState().downloads[modelKey];
    if (!entry) return;
    useDownloadStore.getState().remove(modelKey);
    if (!entry.downloadId) return;
    if (entry.downloadId.startsWith('image-multi:')) {
      await cancelSyntheticImageDownload(modelId).catch(() => {});
      return;
    }
    await backgroundDownloadService
      .cancelDownload(entry.downloadId)
      .catch(() => {});
  };

  return {
    availableHFModels,
    hfModelsLoading,
    hfModelsError,
    backendFilter,
    setBackendFilter,
    styleFilter,
    setStyleFilter,
    sdVersionFilter,
    setSdVersionFilter,
    imageFilterExpanded,
    setImageFilterExpanded,
    imageSearchQuery,
    setImageSearchQuery,
    imageFiltersVisible,
    setImageFiltersVisible,
    imageRec,
    showRecommendedOnly,
    setShowRecommendedOnly,
    showRecHint,
    setShowRecHint,
    downloadedImageModels,
    hasActiveImageFilters,
    filteredHFModels,
    imageRecommendation,
    loadHFModels,
    loadDownloadedImageModels,
    clearImageFilters,
    isRecommendedModel,
    handleDownloadImageModel,
    handleCancelImageDownload,
    setUserChangedBackendFilter,
  };
}
