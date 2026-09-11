import React, { useCallback, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, type ListRenderItemInfo } from 'react-native';
import { LoadingDots } from '../../components/LoadingDots';
import Icon from 'react-native-vector-icons/Feather';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { ModelCard } from '../../components';
import { showAlert } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import { HFImageModel, getVariantLabel } from '../../services/huggingFaceModelBrowser';
import { ImageModelRecommendation } from '../../types';
import {
  createImageDownloadPlan,
  isModelDownloadInProgress,
  modelsFailureMessage,
} from '@offgrid/application';
import { useModelDownloadEntry } from '../../hooks/useModelDownloadsProjection';
import { isDownloadingStatus, isFailedStatus, isPausedStatus, isQueuedStatus } from '../../utils/downloadStatus';
import { imageBackendLabel } from '../../utils/imageBackend';
import { createStyles } from './styles';
import { ModelsScreenViewModel } from './useModelsScreen';
import { ImageFilterBar } from './ImageFilterBar';
import { BackendFilter, ImageFilterDimension } from './types';
import { formatBytes, getImageModelCompatibility, hfModelToDescriptor } from './utils';
import { applicationFacade } from '../../services/applicationFacade';
import { usePendingDownloadCommand } from '../../hooks/usePendingModelCommand';

type Props = Pick<ModelsScreenViewModel,
  | 'imageSearchQuery' | 'setImageSearchQuery'
  | 'hfModelsLoading' | 'hfModelsError'
  | 'filteredHFModels' | 'availableHFModels'
  | 'backendFilter' | 'setBackendFilter'
  | 'styleFilter' | 'setStyleFilter'
  | 'sdVersionFilter' | 'setSdVersionFilter'
  | 'imageFilterExpanded' | 'setImageFilterExpanded'
  | 'imageFiltersVisible' | 'setImageFiltersVisible'
  | 'hasActiveImageFilters'
  | 'showRecommendedOnly' | 'setShowRecommendedOnly'
  | 'showRecHint' | 'setShowRecHint'
  | 'imageRec' | 'ramGB' | 'imageRecommendation'
  | 'handleDownloadImageModel' | 'handleCancelImageDownload' | 'loadHFModels'
  | 'clearImageFilters' | 'setUserChangedBackendFilter'
  | 'isRecommendedModel'
  | 'setAlertState'
  | 'downloadedImageModels'
>;

interface ImageModelCardProps {
  model: HFImageModel & { _coreml?: boolean; _coremlFiles?: any[] };
  index: number;
  imageRec: ImageModelRecommendation | null;
  isRecommendedModel: (model: HFImageModel) => boolean;
  handleDownloadImageModel: Props['handleDownloadImageModel'];
  handleCancelImageDownload: Props['handleCancelImageDownload'];
  setAlertState: Props['setAlertState'];
  isDownloaded: boolean;
}

function imageTransferState(entry: ReturnType<typeof useModelDownloadEntry>, size: number) {
  const active = !!entry && isModelDownloadInProgress(entry.status);
  return {
    isActive: active,
    isQueued: isQueuedStatus(entry?.status),
    isDownloading: isDownloadingStatus(entry?.status),
    isPaused: isPausedStatus(entry?.status),
    hasFailed: isFailedStatus(entry?.status),
    progress: entry && entry.totalBytes > 0 ? entry.bytesDownloaded / entry.totalBytes : 0,
    bytes: entry ? {
      downloaded: entry.bytesDownloaded,
      total: entry.totalBytes || size,
      bytesPerSecond: entry.bytesPerSecond,
    } : undefined,
  };
}

const ImageModelCard: React.FC<ImageModelCardProps> = ({
  model, index, imageRec,
  isRecommendedModel, handleDownloadImageModel, handleCancelImageDownload, setAlertState,
  isDownloaded,
}) => {
  const recommended = isRecommendedModel(model);
  const { isCompatible, incompatibleReason } = getImageModelCompatibility(model, imageRec);
  const descriptor = hfModelToDescriptor(model);
  const plan = createImageDownloadPlan(descriptor);
  const entry = useModelDownloadEntry('image', plan.modelId);
  const downloadPending = usePendingDownloadCommand(plan.modelId, entry?.downloadId, entry?.status);
  const transfer = imageTransferState(entry, model.size);
  const authorLabel = model._coreml ? 'Core ML' : imageBackendLabel(model.backend);
  const variantLabel = model.variant ? getVariantLabel(model.variant) : undefined;
  const controlDownload = async (type: 'pause-download' | 'resume-download') => {
    if (!entry) return;
    const outcome = await applicationFacade().models.control({ type, modelId: entry.downloadId });
    if (!outcome.ok) {
      setAlertState(showAlert(
        type === 'pause-download' ? 'Pause Failed' : 'Resume Failed',
        modelsFailureMessage(outcome.failure),
      ));
    }
  };
  const retryDownload = async () => {
    if (!entry) return;
    const outcome = await applicationFacade().models.control({
      type: 'retry-download',
      modelId: entry.downloadId,
    });
    if (!outcome.ok) setAlertState(showAlert('Retry Failed', modelsFailureMessage(outcome.failure)));
  };
  const removeFailedDownload = async () => {
    if (!entry) return;
    const outcome = await applicationFacade().models.control({
      type: 'clear-download',
      modelId: entry.downloadId,
    });
    if (!outcome.ok) setAlertState(showAlert('Remove Failed', modelsFailureMessage(outcome.failure)));
  };
  return (
    <View>
      <ModelCard
        compact
        model={{
          id: model.id,
          name: model.displayName,
          author: authorLabel,
          sizeBytes: model.size,
          facts: [formatBytes(model.size), ...(variantLabel ? [variantLabel] : [])],
        }}
        isDownloading={transfer.isDownloading}
        isQueued={transfer.isQueued}
        isPaused={transfer.isPaused}
        isDownloadPending={downloadPending}
        isDownloaded={isDownloaded}
        downloadProgress={transfer.progress}
        downloadBytes={transfer.bytes}
        isCompatible={isCompatible}
        incompatibleReason={incompatibleReason}
        testID={`image-model-card-${index}`}
        recommended={recommended ? {} : undefined}
        onDownload={isDownloaded || transfer.isActive || transfer.hasFailed ? undefined : () => handleDownloadImageModel(descriptor)}
        onCancel={transfer.isActive ? () => handleCancelImageDownload(descriptor) : undefined}
        onPause={entry && transfer.isDownloading ? () => { controlDownload('pause-download').catch(() => undefined); } : undefined}
        onResume={entry && transfer.isPaused ? () => { controlDownload('resume-download').catch(() => undefined); } : undefined}
        failedState={transfer.hasFailed && entry ? {
          errorMessage: entry.reason ?? 'Download failed',
          bytesDownloaded: entry.bytesDownloaded,
          totalBytes: entry.totalBytes || model.size,
          onRetry: () => { retryDownload().catch(error => setAlertState(showAlert('Retry Failed', String(error)))); },
          onRemove: () => { removeFailedDownload().catch(error => setAlertState(showAlert('Remove Failed', String(error)))); },
        } : undefined}
      />
    </View>
  );
};

/**
 * Memoized: the catalogue re-renders on every filter and query change, and each card owns a
 * download-store subscription. Without this, one character re-ran that subscription for every
 * row on screen.
 */
const ImageModelCardItem = React.memo(ImageModelCard);
ImageModelCardItem.displayName = 'ImageModelCardItem';

/** Stable identity so the list does not remount while the catalogue is loading or errored. */
const EMPTY_CATALOGUE: (HFImageModel & { _coreml?: boolean; _coremlFiles?: any[] })[] = [];

function shouldShowEmptyMessage({ loading, error, filtered, available }: { loading: boolean; error: string | null; filtered: any[]; available: any[] }): boolean {
  return !loading && !error && filtered.length === 0 && available.length > 0;
}

interface ImageModelsListProps {
  showRecHint: boolean;
  showRecommendedOnly: boolean;
  setShowRecHint: (v: boolean) => void;
  imageRec: ImageModelRecommendation | null;
  ramGB: number;
  imageRecommendation: string;
  imageFiltersVisible: boolean;
  backendFilter: BackendFilter;
  setBackendFilter: (f: BackendFilter) => void;
  styleFilter: string;
  setStyleFilter: (f: string) => void;
  sdVersionFilter: string;
  setSdVersionFilter: (f: string) => void;
  imageFilterExpanded: ImageFilterDimension;
  setImageFilterExpanded: (d: ImageFilterDimension | ((prev: ImageFilterDimension) => ImageFilterDimension)) => void;
  hasActiveImageFilters: boolean;
  clearImageFilters: () => void;
  setUserChangedBackendFilter: (v: boolean) => void;
  hfModelsLoading: boolean;
  hfModelsError: string | null;
  loadHFModels: (forceRefresh?: boolean) => void;
  filteredHFModels: (HFImageModel & { _coreml?: boolean; _coremlFiles?: any[] })[];
  availableHFModels: HFImageModel[];
  isRecommendedModel: (model: HFImageModel) => boolean;
  handleDownloadImageModel: Props['handleDownloadImageModel'];
  handleCancelImageDownload: Props['handleCancelImageDownload'];
  setAlertState: Props['setAlertState'];
  imageSearchQuery: string;
  downloadedImageModelIds: ReadonlySet<string>;
}

const ImageModelsList: React.FC<ImageModelsListProps> = ({
  showRecHint, showRecommendedOnly, setShowRecHint,
  imageRec, ramGB, imageRecommendation,
  imageFiltersVisible, backendFilter, setBackendFilter,
  styleFilter, setStyleFilter, sdVersionFilter, setSdVersionFilter,
  imageFilterExpanded, setImageFilterExpanded,
  hasActiveImageFilters, clearImageFilters, setUserChangedBackendFilter,
  hfModelsLoading, hfModelsError, loadHFModels,
  filteredHFModels, availableHFModels,
  isRecommendedModel, handleDownloadImageModel, handleCancelImageDownload, setAlertState,
  imageSearchQuery,
  downloadedImageModelIds,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  let emptyMessage: string;
  if (imageSearchQuery.trim()) {
    emptyMessage = 'No models match your search';
  } else if (hasActiveImageFilters) {
    emptyMessage = 'No models match your filters';
  } else {
    emptyMessage = 'All available models are downloaded';
  }

  const header = useMemo(
    () => (
      <>
        {showRecHint && showRecommendedOnly && (
          <TouchableOpacity style={styles.recHint} onPress={() => setShowRecHint(false)} activeOpacity={0.7}>
            <Icon name="info" size={11} color={colors.primary} />
            <Text style={styles.recHintText}>
              Showing recommended models only. Tap{' '}<Text style={{ color: colors.primary }}>★</Text>{' '}to see all.
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.deviceBanner}>
          <Text style={styles.deviceBannerText}>{Math.round(ramGB)}GB RAM — {imageRecommendation}</Text>
          {imageRec?.warning && (
            <Text style={[styles.deviceBannerText, styles.deviceBannerWarning]}>{imageRec.warning}</Text>
          )}
        </View>

        {imageFiltersVisible && (
          <ImageFilterBar
            backendFilter={backendFilter}
            setBackendFilter={setBackendFilter}
            styleFilter={styleFilter}
            setStyleFilter={setStyleFilter}
            sdVersionFilter={sdVersionFilter}
            setSdVersionFilter={setSdVersionFilter}
            imageFilterExpanded={imageFilterExpanded}
            setImageFilterExpanded={setImageFilterExpanded}
            hasActiveImageFilters={hasActiveImageFilters}
            clearImageFilters={clearImageFilters}
            setUserChangedBackendFilter={setUserChangedBackendFilter}
          />
        )}

        {hfModelsLoading && (
          <View style={styles.hfLoadingContainer}>
            <LoadingDots color={colors.primary} />
            <Text style={styles.loadingText}>Loading models...</Text>
          </View>
        )}

        {hfModelsError && !hfModelsLoading && (
          <View style={styles.hfErrorContainer}>
            <Text style={styles.hfErrorText}>{hfModelsError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => loadHFModels(true)}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
      </>
    ),
    [
      backendFilter, clearImageFilters, colors.primary, hasActiveImageFilters,
      hfModelsError, hfModelsLoading, imageFilterExpanded, imageFiltersVisible,
      imageRec, imageRecommendation, loadHFModels, ramGB, sdVersionFilter,
      setBackendFilter, setImageFilterExpanded, setSdVersionFilter, setShowRecHint,
      setStyleFilter, setUserChangedBackendFilter, showRecHint, showRecommendedOnly,
      styles, styleFilter,
    ],
  );

  const footer = useMemo(
    () =>
      shouldShowEmptyMessage({ loading: hfModelsLoading, error: hfModelsError, filtered: filteredHFModels, available: availableHFModels })
        ? <Text style={styles.allDownloadedText}>{emptyMessage}</Text>
        : null,
    [availableHFModels, emptyMessage, filteredHFModels, hfModelsError, hfModelsLoading, styles],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<HFImageModel & { _coreml?: boolean; _coremlFiles?: any[] }>) => (
      <ImageModelCardItem
        model={item}
        index={index}
        imageRec={imageRec}
        isRecommendedModel={isRecommendedModel}
        handleDownloadImageModel={handleDownloadImageModel}
        handleCancelImageDownload={handleCancelImageDownload}
        setAlertState={setAlertState}
        isDownloaded={downloadedImageModelIds.has(item.id)}
      />
    ),
    [downloadedImageModelIds, handleCancelImageDownload, handleDownloadImageModel, imageRec, isRecommendedModel, setAlertState],
  );

  const keyExtractor = useCallback(
    (item: HFImageModel) => item.id,
    [],
  );

  return (
    <FlatList
      data={hfModelsLoading || hfModelsError ? EMPTY_CATALOGUE : filteredHFModels}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      contentContainerStyle={styles.imageModelsList}
      keyboardShouldPersistTaps="handled"
      removeClippedSubviews
    />
  );
};

export const ImageModelsTab: React.FC<Props> = ({
  imageSearchQuery, setImageSearchQuery,
  hfModelsLoading, hfModelsError,
  filteredHFModels, availableHFModels,
  backendFilter, setBackendFilter,
  styleFilter, setStyleFilter,
  sdVersionFilter, setSdVersionFilter,
  imageFilterExpanded, setImageFilterExpanded,
  imageFiltersVisible, setImageFiltersVisible,
  hasActiveImageFilters,
  showRecommendedOnly, setShowRecommendedOnly,
  showRecHint, setShowRecHint,
  imageRec, ramGB, imageRecommendation,
  handleDownloadImageModel, handleCancelImageDownload, loadHFModels,
  clearImageFilters, setUserChangedBackendFilter,
  isRecommendedModel,
  setAlertState,
  downloadedImageModels,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const downloadedImageModelIds = useMemo(
    () => new Set(downloadedImageModels.map(model => model.id)),
    [downloadedImageModels],
  );

  return (
    <View style={styles.imageTabContent}>
      <View style={styles.imageModelsSection}>
        <View style={[styles.searchContainer, styles.searchContainerNoPadding]}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search models..."
            placeholderTextColor={colors.textMuted}
            value={imageSearchQuery}
            onChangeText={setImageSearchQuery}
            returnKeyType="search"
          />
          <TouchableOpacity
            style={[styles.recToggle, showRecommendedOnly && styles.recToggleActive]}
            onPress={() => {
              setShowRecHint(false);
              setShowRecommendedOnly(v => { if (v) { setBackendFilter('all'); } return !v; });
            }}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            testID="rec-toggle"
          >
            <MaterialIcon name={showRecommendedOnly ? 'star' : 'star-border'} size={16} color={showRecommendedOnly ? colors.primary : colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterToggle, (imageFiltersVisible || hasActiveImageFilters) && styles.filterToggleActive]}
            onPress={() => setImageFiltersVisible(v => !v)}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityRole="button"
            accessibilityLabel="Filter image models"
          >
            <Icon name="sliders" size={14} color={(imageFiltersVisible || hasActiveImageFilters) ? colors.primary : colors.textMuted} />
            {hasActiveImageFilters && <View style={styles.filterDot} />}
          </TouchableOpacity>
        </View>
      </View>

      <ImageModelsList
        showRecHint={showRecHint}
        showRecommendedOnly={showRecommendedOnly}
        setShowRecHint={setShowRecHint}
        imageRec={imageRec}
        ramGB={ramGB}
        imageRecommendation={imageRecommendation}
        imageFiltersVisible={imageFiltersVisible}
        backendFilter={backendFilter}
        setBackendFilter={setBackendFilter}
        styleFilter={styleFilter}
        setStyleFilter={setStyleFilter}
        sdVersionFilter={sdVersionFilter}
        setSdVersionFilter={setSdVersionFilter}
        imageFilterExpanded={imageFilterExpanded}
        setImageFilterExpanded={setImageFilterExpanded}
        hasActiveImageFilters={hasActiveImageFilters}
        clearImageFilters={clearImageFilters}
        setUserChangedBackendFilter={setUserChangedBackendFilter}
        hfModelsLoading={hfModelsLoading}
        hfModelsError={hfModelsError}
        loadHFModels={loadHFModels}
        filteredHFModels={filteredHFModels as (HFImageModel & { _coreml?: boolean; _coremlFiles?: any[] })[]}
        availableHFModels={availableHFModels}
        isRecommendedModel={isRecommendedModel}
        handleDownloadImageModel={handleDownloadImageModel}
        handleCancelImageDownload={handleCancelImageDownload}
        setAlertState={setAlertState}
        imageSearchQuery={imageSearchQuery}
        downloadedImageModelIds={downloadedImageModelIds}
      />
    </View>
  );
};
