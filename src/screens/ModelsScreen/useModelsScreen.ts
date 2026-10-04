import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigation } from '@react-navigation/native';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { showAlert, AlertState, initialAlertState } from '../../components/CustomAlert';
import { useFocusTrigger } from '../../hooks/useFocusTrigger';
import { useAppStore } from '../../stores';
import { isActiveStatus, isFailedStatus } from '../../stores/downloadStore';
import { useModelDownloadsProjection } from '../../hooks/useModelDownloadsProjection';
import { mobileTextEngineControl } from '../../services/modelServices/textEngineControl';
import { ModelTab, NavigationProp } from './types';
import { initialFilterState } from './constants';
import { useTextModels } from './useTextModels';
import { useImageModels } from './useImageModels';
import { importGgufFiles, getErrorMessage } from './importHelpers';
import { isPickerStuck } from '../../utils/pickerErrorUtils';
import { classifyModelImport } from '@offgrid/application';
import { importMobileImageArchive } from '../../services/adapters/models/library/imageArchiveImportAdapter';


export function useModelsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const focusTrigger = useFocusTrigger();
  const [activeTab, setActiveTabState] = useState<ModelTab>('text');
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ fraction: number; fileName: string } | null>(null);

  // Action only. A whole-store read here re-ran the Models screen on every unrelated app write.
  const { addDownloadedModel } = useAppStore.getState();

  const text = useTextModels(setAlertState);
  const image = useImageModels(setAlertState);

  useEffect(() => {
    if (activeTab === 'image' && image.availableHFModels.length === 0 && !image.hfModelsLoading) {
      image.loadHFModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const setActiveTab = (tab: ModelTab) => {
    setActiveTabState(tab);
    text.setFilterState(initialFilterState);
    text.setTextFiltersVisible(false);
    image.setImageFiltersVisible(false);
  };

  const handleRefresh = async () => {
    text.setIsRefreshing(true);
    await text.loadDownloadedModels();
    await image.loadDownloadedImageModels();
    if (text.hasSearched && text.searchQuery.trim()) await text.handleSearch();
    if (activeTab === 'image') await image.loadHFModels(true);
    text.setIsRefreshing(false);
  };

  const handleImportImageModelZip = async (sourceUri: string, fileName: string) => {
    const result = await importMobileImageArchive({
      sourceUri,
      fileName,
      onProgress: progress => setImportProgress({ fraction: progress.fraction, fileName: progress.fileName }),
    });
    if (result.status === 'imported') {
      const repairMessage = result.repair
        ? ` The model was imported, but ${result.repair.kind === 'activate' ? 'it could not be selected' : result.repair.kind === 'refresh' ? 'the model list could not be refreshed' : 'temporary files could not be removed'}.`
        : '';
      setAlertState(showAlert('Success', `${result.model.name} imported successfully.${repairMessage}`));
      return;
    }
    const cleanup = result.repair.kind === 'cleanup_required'
      ? ' Temporary files could not be removed. Try the import again after restarting the app.'
      : '';
    setAlertState(showAlert('Import Failed', `${result.error}${cleanup}`));
  };

  const isPickingRef = useRef(false);

  const handleImportLocalModel = async () => {
    if (isImporting || isPickingRef.current) return;
    isPickingRef.current = true;
    setIsImporting(true);
    try {
      const result = await pick({ type: [types.allFiles], allowMultiSelection: true });

      if (!result || result.length === 0) return;

      const resolvedFiles = result.map(f => ({
        ...f,
        name: (f.name?.trim() || decodeURIComponent(f.uri.split('/').pop() ?? '') || 'unknown').split('/').pop() || 'unknown',
      }));

      const selection = classifyModelImport({
        artifacts: resolvedFiles.map(file => ({
          uri: file.uri,
          name: file.name,
          sizeBytes: file.size ?? 0,
        })),
        liteRTAvailable: mobileTextEngineControl.isProviderAvailable('litert'),
      });
      const validationError = selection.type === 'invalid' ? selection.reason : null;
      if (validationError === 'litert_unsupported') {
        setAlertState(showAlert('Not Supported', 'LiteRT models are only supported on Android.'));
        return;
      }
      if (validationError === 'invalid_format') {
        setAlertState(showAlert(
          'Invalid File',
          resolvedFiles.length > 1
            ? 'When selecting multiple files, all must be .gguf files (main model + mmproj projector).'
            : 'Supported formats: .gguf (text models), .litertlm (LiteRT models), and .zip (image models).',
        ));
        return;
      }
      if (validationError === 'too_many') {
        setAlertState(showAlert('Too Many Files', 'Select 1 file (text/zip/litertlm) or 2 .gguf files (vision model + mmproj projector).'));
        return;
      }

      if (selection.type === 'invalid') return;
      const firstUri = selection.type === 'image-archive' ? selection.archive.uri : selection.primary.uri;
      const firstFileName = selection.type === 'image-archive' ? selection.archive.name : selection.primary.name;
      setImportProgress({ fraction: 0, fileName: firstFileName });

      if (selection.type === 'image-archive') {
        await handleImportImageModelZip(firstUri, firstFileName);
        return;
      }

      await importGgufFiles(resolvedFiles.slice(0, 2), { setAlertState, setImportProgress, addDownloadedModel });
    } catch (error: unknown) {
      if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) return;
      if (isPickerStuck(error)) {
        setAlertState(showAlert(
          'File Picker Unavailable',
          "The file picker isn't responding. Please close and reopen the app, then try again.",
        ));
        return;
      }
      setAlertState(showAlert('Import Failed', getErrorMessage(error)));
    } finally {
      isPickingRef.current = false;
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  const downloads = useModelDownloadsProjection();
  const activeDownloadCount = downloads.filter(d => isActiveStatus(d.status)).length;
  // The icon badge answers "is there download work outstanding?" — so it counts active AND
  // failed/retriable (a failed download needs a retry or remove and must not be invisible).
  const downloadBadgeCount = downloads.filter(
    d => isActiveStatus(d.status) || isFailedStatus(d.status),
  ).length;
  const totalModelCount =
    text.downloadedModels.length +
    image.downloadedImageModels.length +
    activeDownloadCount;

  // No caller-side "too many downloads" gate: backgroundDownloadService caps real
  // concurrency at MAX_CONCURRENT_DOWNLOADS and FIFO-queues the rest, so extra starts
  // just queue (shown as "Queued") instead of hurting performance. The old
  // "Starting more can affect performance / Start Anyway" alert was obsolete friction
  // (and its threshold of 2 didn't even match the cap of 3).
  const handleDownload = useCallback(
    (...args: Parameters<typeof text.handleDownload>) => {
      text.handleDownload(...args);
    },
    [text],
  );

  const handleDownloadImageModel = useCallback(
    (...args: Parameters<typeof image.handleDownloadImageModel>) => {
      image.handleDownloadImageModel(...args);
    },
    [image],
  );

  return {
    navigation,
    focusTrigger,
    activeTab,
    setActiveTab,
    alertState,
    setAlertState,
    isImporting,
    importProgress,
    totalModelCount,
    activeDownloadCount,
    downloadBadgeCount,
    handleImportLocalModel,
    handleRefresh,
    // text model state & handlers
    searchQuery: text.searchQuery,
    setSearchQuery: text.setSearchQuery,
    isLoading: text.isLoading,
    isRefreshing: text.isRefreshing,
    hasSearched: text.hasSearched,
    selectedModel: text.selectedModel,
    setSelectedModel: text.setSelectedModel,
    modelFiles: text.modelFiles,
    setModelFiles: text.setModelFiles,
    isLoadingFiles: text.isLoadingFiles,
    filterState: text.filterState,
    setFilterState: text.setFilterState,
    textFiltersVisible: text.textFiltersVisible,
    setTextFiltersVisible: text.setTextFiltersVisible,
    downloadedModels: text.downloadedModels,
    hasActiveFilters: text.hasActiveFilters,
    ramGB: text.ramGB,
    deviceRecommendation: text.deviceRecommendation,
    filteredResults: text.filteredResults,
    recommendedAsModelInfo: text.recommendedAsModelInfo,
    trendingAsModelInfo: text.trendingAsModelInfo,
    handleSearch: text.handleSearch,
    handleSelectModel: text.handleSelectModel,
    handleDownload,
    handleRepairMmProj: text.handleRepairMmProj,
    handleCancelDownload: text.handleCancelDownload,
    handleDeleteModel: text.handleDeleteModel,
    clearFilters: text.clearFilters,
    toggleFilterDimension: text.toggleFilterDimension,
    toggleOrg: text.toggleOrg,
    setTypeFilter: text.setTypeFilter,
    setSourceFilter: text.setSourceFilter,
    setSizeFilter: text.setSizeFilter,
    setQuantFilter: text.setQuantFilter,
    setSortOption: text.setSortOption,
    isModelDownloaded: text.isModelDownloaded,
    getDownloadedModel: text.getDownloadedModel,
    isRepairingVisionModel: text.isRepairingVisionModel,
    // image model state & handlers
    availableHFModels: image.availableHFModels,
    hfModelsLoading: image.hfModelsLoading,
    hfModelsError: image.hfModelsError,
    backendFilter: image.backendFilter,
    setBackendFilter: image.setBackendFilter,
    styleFilter: image.styleFilter,
    setStyleFilter: image.setStyleFilter,
    sdVersionFilter: image.sdVersionFilter,
    setSdVersionFilter: image.setSdVersionFilter,
    imageFilterExpanded: image.imageFilterExpanded,
    setImageFilterExpanded: image.setImageFilterExpanded,
    imageSearchQuery: image.imageSearchQuery,
    setImageSearchQuery: image.setImageSearchQuery,
    imageFiltersVisible: image.imageFiltersVisible,
    setImageFiltersVisible: image.setImageFiltersVisible,
    imageRec: image.imageRec,
    showRecommendedOnly: image.showRecommendedOnly,
    setShowRecommendedOnly: image.setShowRecommendedOnly,
    showRecHint: image.showRecHint,
    setShowRecHint: image.setShowRecHint,
    downloadedImageModels: image.downloadedImageModels,
    hasActiveImageFilters: image.hasActiveImageFilters,
    filteredHFModels: image.filteredHFModels,
    imageRecommendation: image.imageRecommendation,
    loadHFModels: image.loadHFModels,
    clearImageFilters: image.clearImageFilters,
    isRecommendedModel: image.isRecommendedModel,
    handleDownloadImageModel,
    handleCancelImageDownload: image.handleCancelImageDownload,
    setUserChangedBackendFilter: image.setUserChangedBackendFilter,
  };
}

export type ModelsScreenViewModel = ReturnType<typeof useModelsScreen>;
