import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { LoadingDots } from '../../components/LoadingDots';
import Icon from 'react-native-vector-icons/Feather';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { ModelCard } from '../../components';
import { useTheme, useThemedStyles } from '../../theme';
import { HFImageModel, getVariantLabel } from '../../services/huggingFaceModelBrowser';
import { ImageModelRecommendation } from '../../types';
import { useAppStore } from '../../stores';
import { useDownloadStore, isActiveStatus, isQueuedStatus, isDownloadingStatus } from '../../stores/downloadStore';
import { makeImageModelKey } from '../../utils/modelKey';
import { imageBackendLabel } from '../../utils/imageBackend';
import { createStyles } from './styles';
import { ModelsScreenViewModel } from './useModelsScreen';
import { ImageFilterBar } from './ImageFilterBar';
import { BackendFilter, ImageFilterDimension } from './types';
import { formatBytes, getImageModelCompatibility, hfModelToDescriptor } from './utils';
import { modelDownloadService } from '../../services/modelDownloadService';
import { uniformDownloadId } from '../../services/modelDownloadService/uniformId';
import logger from '../../utils/logger';

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
>;

interface ImageModelCardProps {
  model: HFImageModel & { _coreml?: boolean; _coremlFiles?: any[] };
  index: number;
  imageRec: ImageModelRecommendation | null;
  isRecommendedModel: (model: HFImageModel) => boolean;
  handleDownloadImageModel: Props['handleDownloadImageModel'];
  handleCancelImageDownload: Props['handleCancelImageDownload'];
}

export const ImageModelCardItem: React.FC<ImageModelCardProps> = ({
  model, index, imageRec,
  isRecommendedModel, handleDownloadImageModel, handleCancelImageDownload,
}) => {
  const recommended = isRecommendedModel(model);
  const { isCompatible, incompatibleReason } = getImageModelCompatibility(model, imageRec);
  // Single source of truth: live download status read from useDownloadStore
  // via the stable image:<id> modelKey. Replaces drilled imageModelDownloading
  // and imageModelProgress props.
  const entry = useDownloadStore(s => s.downloads[makeImageModelKey(model.id)]);
  // Classify with the SAME shared predicate the Download Manager uses (isActiveStatus).
  // The old `status !== 'completed' && status !== 'cancelled'` bucketed a *failed* row
  // as "downloading", so a kill-orphaned download showed a fake "downloading 0%" here
  // while the Download Manager (correctly) showed it failed → Retry/Remove. One rule,
  // one source of truth: a failed/interrupted row is NOT active, so the card offers a
  // fresh download (which routes through retryEntry) instead of lying about progress.
  // Active = queued OR transferring (gates the download/cancel affordance). Split
  // queued vs downloading via the shared classifier so a queued image renders the
  // clock — same rule as every other tab, no per-surface re-derivation.
  const isActive = !!entry && isActiveStatus(entry.status);
  const isQueued = !!entry && isQueuedStatus(entry.status);
  const isDownloading = !!entry && isDownloadingStatus(entry.status);
  const isPaused = entry?.status === 'paused';
  const progressValue = entry?.progress ?? 0;
  // A downloaded model stays in the catalog and shows as downloaded (as on the Text tab),
  // so finishing a download never makes the card vanish.
  const isDownloaded = useAppStore(s => s.downloadedImageModels.some(d => d.id === model.id));
  const isActiveModel = useAppStore(s => s.activeImageModelId === model.id);
  const authorLabel = model._coreml ? 'Core ML' : imageBackendLabel(model.backend);
  const variantSuffix = model.variant ? ` \u00B7 ${getVariantLabel(model.variant)}` : '';
  return (
    <View>
      <ModelCard
        compact
        recommended={recommended ? {} : undefined}
        model={{
          id: model.id,
          name: model.displayName,
          author: authorLabel,
          description: `${formatBytes(model.size)}${variantSuffix}`,
        }}
        isDownloaded={isDownloaded}
        isActive={isDownloaded && isActiveModel}
        isDownloading={isDownloading}
        isPaused={isPaused}
        isQueued={isQueued}
        downloadProgress={progressValue}
        downloadBytes={entry ? {
          downloaded: entry.bytesDownloaded + (entry.mmProjBytesDownloaded ?? 0),
          total: entry.combinedTotalBytes || entry.totalBytes || model.size,
          bytesPerSecond: entry.bytesPerSecond,
        } : undefined}
        isCompatible={isCompatible}
        incompatibleReason={incompatibleReason}
        testID={`image-model-card-${index}`}
        onDownload={isDownloaded || isActive || isPaused ? undefined : () => handleDownloadImageModel(hfModelToDescriptor(model))}
        onCancel={isActive || isPaused ? () => handleCancelImageDownload(model.id) : undefined}
        onPause={isDownloading && entry?.downloadId ? () => {
          modelDownloadService.pause(uniformDownloadId('image', model.id)).catch(error => logger.error('Failed to pause image download:', error));
        } : undefined}
        onResume={isPaused && entry?.downloadId ? () => {
          modelDownloadService.resume(uniformDownloadId('image', model.id)).catch(error => logger.error('Failed to resume image download:', error));
        } : undefined}
      />
    </View>
  );
};

function shouldShowEmptyMessage({ loading, error, filtered, available }: { loading: boolean; error: string | null; filtered: any[]; available: any[] }): boolean {
  return !loading && !error && filtered.length === 0 && available.length > 0;
}

interface ScrollContentProps {
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
  imageSearchQuery: string;
}

const ImageModelsScrollContent: React.FC<ScrollContentProps> = ({
  showRecHint, showRecommendedOnly, setShowRecHint,
  imageRec, ramGB, imageRecommendation,
  imageFiltersVisible, backendFilter, setBackendFilter,
  styleFilter, setStyleFilter, sdVersionFilter, setSdVersionFilter,
  imageFilterExpanded, setImageFilterExpanded,
  hasActiveImageFilters, clearImageFilters, setUserChangedBackendFilter,
  hfModelsLoading, hfModelsError, loadHFModels,
  filteredHFModels, availableHFModels,
  isRecommendedModel, handleDownloadImageModel, handleCancelImageDownload,
  imageSearchQuery,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  let emptyMessage: string;
  if (imageSearchQuery.trim()) {
    emptyMessage = 'No models match your search';
  } else if (hasActiveImageFilters) {
    emptyMessage = 'No models match your filters';
  } else {
    emptyMessage = 'No models available';
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <View style={styles.imageModelsList}>
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

        {!hfModelsLoading && !hfModelsError && filteredHFModels.map(
          (model, index) => {
            const card = (
              <ImageModelCardItem
                key={model.id}
                model={model}
                index={index}
                imageRec={imageRec}
                isRecommendedModel={isRecommendedModel}
                handleDownloadImageModel={handleDownloadImageModel}
                handleCancelImageDownload={handleCancelImageDownload}
              />
            );
            if (index === 0) {
              return card;
            }
            return card;
          }
        )}

        {shouldShowEmptyMessage({ loading: hfModelsLoading, error: hfModelsError, filtered: filteredHFModels, available: availableHFModels }) && (
          <Text style={styles.allDownloadedText}>{emptyMessage}</Text>
        )}
      </View>
    </ScrollView>
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
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

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
          >
            <Icon name="sliders" size={14} color={(imageFiltersVisible || hasActiveImageFilters) ? colors.primary : colors.textMuted} />
            {hasActiveImageFilters && <View style={styles.filterDot} />}
          </TouchableOpacity>
        </View>
      </View>

      <ImageModelsScrollContent
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
        imageSearchQuery={imageSearchQuery}
      />
    </View>
  );
};
