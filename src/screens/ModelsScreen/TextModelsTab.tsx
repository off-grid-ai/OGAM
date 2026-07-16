import React, { useEffect } from 'react';
import { View, Text, FlatList, TextInput, ActivityIndicator, RefreshControl, TouchableOpacity, InteractionManager, Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import Icon from 'react-native-vector-icons/Feather';
import { fileExceedsBudget } from '../../services/memoryBudget';
import { AttachStep, useSpotlightTour } from 'react-native-spotlight-tour';
import { Card, ModelCard } from '../../components';
import { AnimatedEntry } from '../../components/AnimatedEntry';
import { CustomAlert, hideAlert, showAlert, AlertState } from '../../components/CustomAlert';
import { consumePendingSpotlight, peekPendingSpotlight, setPendingSpotlight } from '../../components/onboarding/spotlightState';
import { DOWNLOAD_MANAGER_STEP_INDEX } from '../../components/onboarding/spotlightConfig';
import { useTheme, useThemedStyles } from '../../theme';
import { needsVisionRepair as checkNeedsVisionRepair } from '../../utils/visionRepair';
import { CREDIBILITY_LABELS } from '../../constants';
import { ModelInfo, ModelFile } from '../../types';
import { createStyles } from './styles';
import { ModelsScreenViewModel } from './useModelsScreen';
import { useDownloadStore, isActiveStatus, isQueuedStatus } from '../../stores/downloadStore';
import { makeModelKey } from '../../utils/modelKey';
import { modelSupportsNpuGpu, isAccelerableQuant } from '../../utils/acceleration';
import { aggregateActiveDownloads } from '../../utils/downloadAggregate';
import { TextFiltersSection } from './TextFiltersSection';
import { FilterState, SortOption } from './types';
import { SORT_OPTIONS } from './constants';
import { formatNumber, getTextModelCompatibility } from './utils';
import { curatedLiteRTDownloadWarning, LITERT_PARENT_ID } from '../../services/curatedLiteRTRegistry';
import { LITERT_FILE_META, LITERT_RECOMMENDED_MODEL, LITERT_PARENT_RECOMMENDED } from './litertRecommended';
import { modelManager } from '../../services';
import { modelDownloadService } from '../../services/modelDownloadService';
import { uniformDownloadId } from '../../services/modelDownloadService/uniformId';

function hasNonSortFilters(fs: FilterState): boolean {
  return fs.orgs.length > 0 || fs.type !== 'all' || fs.source !== 'all' || fs.size !== 'all' || fs.quant !== 'all';
}

function getEmptyText(hasSearched: boolean, hasActiveFilters: boolean): string {
  if (!hasSearched) return 'No recommended models available.';
  if (hasActiveFilters) return 'No models match your filters. Try adjusting or clearing them.';
  return 'No models found. Try a different search term.';
}

type Props = Pick<ModelsScreenViewModel,
  | 'searchQuery' | 'setSearchQuery'
  | 'isLoading' | 'isRefreshing'
  | 'hasSearched'
  | 'selectedModel' | 'setSelectedModel'
  | 'modelFiles' | 'setModelFiles'
  | 'isLoadingFiles'
  | 'filterState'
  | 'textFiltersVisible' | 'setTextFiltersVisible'
  | 'filteredResults' | 'recommendedAsModelInfo' | 'trendingAsModelInfo'
  | 'ramGB' | 'deviceRecommendation'
  | 'hasActiveFilters'
  | 'downloadedModels'
  | 'alertState' | 'setAlertState'
  | 'focusTrigger'
  | 'handleSearch' | 'handleRefresh'
  | 'handleSelectModel' | 'handleDownload' | 'handleRepairMmProj' | 'handleCancelDownload' | 'handleDeleteModel'
  | 'clearFilters'
  | 'toggleFilterDimension' | 'toggleOrg'
  | 'setTypeFilter' | 'setSourceFilter' | 'setSizeFilter' | 'setQuantFilter' | 'setSortOption'
  | 'isModelDownloaded' | 'getDownloadedModel' | 'isRepairingVisionModel'
>;

type DetailProps = Pick<Props,
  | 'modelFiles' | 'isLoadingFiles' | 'filterState' | 'ramGB'
  | 'alertState' | 'setAlertState'
  | 'getDownloadedModel' | 'isModelDownloaded' | 'isRepairingVisionModel'
  | 'handleDownload' | 'handleRepairMmProj' | 'handleCancelDownload' | 'handleDeleteModel'
> & { selectedModel: ModelInfo; onBack: () => void; };

// Build the file card's onDownload handler. Whether to show the curated confirm-download
// warning is the registry's single DEVICE-AWARE decision (curatedLiteRTDownloadWarning),
// shared with the onboarding screen — never a static per-model flag re-derived here.
function buildFileDownloadHandler({ s, fileName, sizeBytes, ramGB, proceedDownload, setAlertState }: {
  s: { downloaded: boolean; progress: unknown; hasFailed: boolean };
  fileName: string;
  sizeBytes: number; ramGB: number;
  proceedDownload: () => void;
  setAlertState: (state: AlertState) => void;
}): (() => void) | undefined {
  if (s.downloaded || s.progress || s.hasFailed) return undefined;
  return () => {
    const warning = curatedLiteRTDownloadWarning(fileName, sizeBytes, ramGB);
    if (warning) {
      setAlertState(showAlert(warning.title, warning.message, [
        { text: 'Cancel', style: 'cancel', onPress: () => setAlertState(hideAlert()) },
        { text: 'Download anyway', style: 'default', onPress: () => { setAlertState(hideAlert()); proceedDownload(); } },
      ]));
      return;
    }
    proceedDownload();
  };
}

const ModelDetailView: React.FC<DetailProps> = ({
  selectedModel, modelFiles, isLoadingFiles, filterState, ramGB,
  alertState, setAlertState, onBack,
  getDownloadedModel, isModelDownloaded, isRepairingVisionModel,
  handleDownload, handleRepairMmProj, handleCancelDownload, handleDeleteModel,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { goTo } = useSpotlightTour();

  // If user arrived here via onboarding spotlight flow, show file card spotlight
  // Pre-set the next pending (Download Manager icon) so it fires regardless of
  // how the user dismisses step 9 (button or backdrop tap).
  useEffect(() => {
    const pending = consumePendingSpotlight();
    if (pending !== null) {
      setPendingSpotlight(DOWNLOAD_MANAGER_STEP_INDEX);
      const task = InteractionManager.runAfterInteractions(() => goTo(pending));
      return () => task.cancel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Heal the durable vision flag from the authoritative catalog: this screen KNOWS a model is vision (its
  // repo ships an mmproj → modelFiles carry mmProjFile), so persist isVisionModel:true onto any downloaded
  // record that lost it (old link-cleanup bug). The Download Manager has no catalog, so this makes the
  // RECORD the single source both surfaces read — the wrench then shows consistently (device 2026-07-14).
  useEffect(() => {
    for (const f of modelFiles) {
      if (!f.mmProjFile) continue;
      const rec = getDownloadedModel(selectedModel.id, f.name);
      if (rec?.engine === 'llama' && !rec.isVisionModel) void modelManager.markVisionModel(rec.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel.id, modelFiles]);

  const storeDownloads = useDownloadStore(state => state.downloads);

  const getFileCardState = (item: ModelFile) => {
    const modelKey = makeModelKey(selectedModel.id, item.name);
    const entry = storeDownloads[modelKey];
    const downloaded = isModelDownloaded(selectedModel.id, item.name);
    const downloadedModel = getDownloadedModel(selectedModel.id, item.name);
    const needsVisionRepair = checkNeedsVisionRepair(downloadedModel, item);
    const repairingVision = isRepairingVisionModel(`${selectedModel.id}/${item.name}`);
    let progress = entry
      ? {
        progress: entry.progress,
        bytesDownloaded: entry.bytesDownloaded + (entry.mmProjBytesDownloaded ?? 0),
        totalBytes: entry.combinedTotalBytes,
        status: entry.status,
      }
      : undefined;

    // For completed downloads, discard if size doesn't match expected
    if (progress && progress.status === 'completed' && progress.bytesDownloaded < item.size) {
      progress = undefined;
    }
    const canCancel   = !!entry && isActiveStatus(entry.status);
    const hasFailed   = entry?.status === 'failed';
    const errorMessage = hasFailed ? (entry?.errorMessage ?? 'Download failed') : undefined;
    return { downloadKey: modelKey, progress, downloaded, downloadedModel, needsVisionRepair, repairingVision, canCancel, hasFailed, errorMessage };
  };

  const renderFileItem = ({ item, index }: { item: ModelFile; index: number }) => {
    const s = getFileCardState(item);
    const proceedDownload = () => {
      handleDownload(selectedModel, item);
      if (peekPendingSpotlight() !== null) setTimeout(onBack, 800);
    };
    const onDownload = buildFileDownloadHandler({ s, fileName: item.name, sizeBytes: item.size, ramGB, proceedDownload, setAlertState });
    const liteRTMeta = LITERT_FILE_META[item.name];
    const displayName = liteRTMeta?.displayName ?? item.name.replace('.gguf', '');
    const recommended = liteRTMeta ? { pillLabel: 'Recommended', highlightText: liteRTMeta.highlight } : undefined;
    const storeEntry = storeDownloads[s.downloadKey];
    // Retry routes through the single owner (modelDownloadService → textProvider): Android resumes the
    // native row, iOS re-issues from the entry's metadata. The provider owns the platform decision AND
    // the lost-downloadId case (a rehydrated app-killed entry can have no downloadId), so the failed
    // card must render its Retry regardless of downloadId — gating on it here made iOS retry unreachable.
    const failedState = s.hasFailed && s.errorMessage && storeEntry
      ? {
        errorMessage: s.errorMessage,
        bytesDownloaded: storeEntry.bytesDownloaded,
        totalBytes: storeEntry.combinedTotalBytes || storeEntry.totalBytes,
        onRetry: () => { modelDownloadService.retry(uniformDownloadId('text', s.downloadKey)).catch(() => {}); },
        onRemove: () => handleCancelDownload(s.downloadKey),
      }
      : undefined;
    const inner = (
      <ModelCard
        model={{ id: selectedModel.id, name: displayName, author: selectedModel.author, credibility: selectedModel.credibility }}
        file={item} downloadedModel={s.downloadedModel} isDownloaded={s.downloaded}
        isDownloading={!!s.progress && !s.hasFailed && !isQueuedStatus(s.progress.status)}
        isQueued={isQueuedStatus(s.progress?.status ?? 'completed')}
        downloadProgress={s.progress?.progress}
        downloadBytes={s.progress && !s.hasFailed ? { downloaded: s.progress.bytesDownloaded, total: s.progress.totalBytes } : undefined}
        isRepairingVision={s.repairingVision}
        isCompatible={!fileExceedsBudget(item.size, ramGB)} testID={`file-card-${index}`}
        onDownload={onDownload}
        onDelete={s.downloaded ? () => handleDeleteModel(`${selectedModel.id}/${item.name}`) : undefined}
        onRepairVision={s.needsVisionRepair && !s.progress && !s.repairingVision ? () => handleRepairMmProj(selectedModel, item) : undefined}
        onCancel={s.canCancel ? () => handleCancelDownload(s.downloadKey) : undefined}
        recommended={recommended}
        supportsAcceleration={isAccelerableQuant(item.quantization) || !!liteRTMeta}
        failedState={failedState}
      />
    );
    return index === 0 ? <AttachStep index={9} fill>{inner}</AttachStep> : inner;
  };

  return (
    <View testID="model-detail-screen" style={styles.flex1}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} testID="model-detail-back" style={styles.backButton}>
          <Icon name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, styles.flex1]} numberOfLines={1}>{selectedModel.name}</Text>
      </View>
      <Card style={styles.modelInfoCard}>
        <View style={styles.authorRow}>
          <Text style={styles.modelAuthor}>{selectedModel.author}</Text>
          {selectedModel.credibility && (
            <View style={[styles.credibilityBadge, { backgroundColor: `${CREDIBILITY_LABELS[selectedModel.credibility.source].color}25` }]}>
              {selectedModel.credibility.source === 'lmstudio' && <Text style={[styles.credibilityIcon, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>★</Text>}
              {selectedModel.credibility.source === 'official' && <Text style={[styles.credibilityIcon, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>✓</Text>}
              {selectedModel.credibility.source === 'verified-quantizer' && <Text style={[styles.credibilityIcon, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>◆</Text>}
              <Text style={[styles.credibilityText, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>
                {CREDIBILITY_LABELS[selectedModel.credibility.source].label}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.modelDescription}>{selectedModel.description}</Text>
        {(selectedModel.downloads > 0 || selectedModel.likes > 0) && (
          <View style={styles.modelStats}>
            {selectedModel.downloads > 0 && (
              <Text style={styles.statText}>{formatNumber(selectedModel.downloads)} downloads</Text>
            )}
            {selectedModel.likes > 0 && (
              <Text style={styles.statText}>{formatNumber(selectedModel.likes)} likes</Text>
            )}
          </View>
        )}
      </Card>
      {selectedModel.id === LITERT_PARENT_ID && Platform.OS === 'android' && DeviceInfo.getModel().toLowerCase().includes('pixel 10') && (
        <Card style={styles.deviceBanner}>
          <Icon name="info" size={14} color={colors.trending} />
          <Text style={styles.deviceBannerText}>{'GPU acceleration is not yet supported on Pixel 10. Models will run on CPU. Support coming soon.'}</Text>
        </Card>
      )}
      <Text style={styles.sectionTitle}>Available Files</Text>
      {selectedModel.id !== LITERT_PARENT_ID && (
        <Text style={styles.sectionSubtitle}>
          Choose a quantization level. Q4_K_M is recommended for mobile.
          {modelFiles.some(f => f.mmProjFile) && ' Vision files include mmproj.'}
        </Text>
      )}
      {isLoadingFiles ? (
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <FlatList
          data={modelFiles
            .filter(f => f.size > 0 && !fileExceedsBudget(f.size, ramGB) && (filterState.quant === 'all' || f.name.includes(filterState.quant)))
            .sort((a, b) => {
              if (selectedModel.id === LITERT_PARENT_ID) return a.size - b.size; // curated: small-first
              // Tier: Q4_K_M (CPU default, lowest size) → GPU/NPU Q4_0/Q8_0 → rest (CPU
              // fallback). Accelerable tier small-first (Q4_0 before Q8_0); others size desc.
              const tier = (f: ModelFile) => f.name.includes('Q4_K_M') ? 0 : isAccelerableQuant(f.quantization) ? 1 : 2;
              if (tier(a) !== tier(b)) return tier(a) - tier(b);
              return tier(a) === 1 ? a.size - b.size : b.size - a.size;
            })}
          renderItem={renderFileItem}
          keyExtractor={item => item.name}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Card style={styles.emptyCard}><Text style={styles.emptyText}>No compatible files found for this model.</Text></Card>}
        />
      )}
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </View>
  );
};

const DeviceBanner: React.FC<{ ramGB: number; rec: { maxParameters: number; recommendedQuantization: string }; showTitle: boolean; styles: any }> = ({ ramGB, rec, showTitle, styles }) => (
  <View>
    <View style={styles.deviceBanner}><Text style={styles.deviceBannerText}>{Math.round(ramGB)}GB RAM — models up to {rec.maxParameters}B recommended ({rec.recommendedQuantization})</Text></View>
    {showTitle && <Text style={styles.recommendedTitle}>Recommended for your device</Text>}
  </View>
);

interface ModelListItemProps {
  item: ModelInfo; index: number; focusTrigger: number;
  isDownloaded: boolean; isTrending: boolean; onPress: () => void;
}
const ModelListItem: React.FC<ModelListItemProps> = ({ item, index, focusTrigger, isDownloaded, isTrending, onPress }) => {
  const { isCompatible, incompatibleReason } = getTextModelCompatibility(item);
  const isLiteRTParent = item.id === LITERT_PARENT_ID;
  const recommended = isLiteRTParent ? LITERT_PARENT_RECOMMENDED : undefined;
  // Aggregate ALL in-flight entries for this model (main+mmproj / grouped LiteRT) into
  // cumulative progress/bytes + a download count, so the card shows total, not one entry.
  const downloads = useDownloadStore(s => s.downloads);
  const agg = React.useMemo(() => aggregateActiveDownloads(downloads, item.id), [downloads, item.id]);
  // Strip files for the LiteRT parent so ModelCard skips the size-range / "N files"
  // badges (curated chips cover it); the original item still flows through onPress.
  const cardModel = isLiteRTParent ? { ...item, files: undefined } : item;
  const card = (<AnimatedEntry index={index} staggerMs={30} trigger={focusTrigger}><ModelCard model={cardModel} isDownloaded={isDownloaded} isDownloading={agg.downloading} isQueued={agg.queued} downloadProgress={agg.progress} downloadBytes={agg.bytes} downloadCount={agg.count} isCompatible={isCompatible} incompatibleReason={incompatibleReason} onPress={isCompatible ? onPress : undefined} testID={`model-card-${index}`} compact isTrending={isTrending} recommended={recommended} supportsAcceleration={!isLiteRTParent && modelSupportsNpuGpu(item)} /></AnimatedEntry>);
  return index === 0 ? <AttachStep index={0} fill>{card}</AttachStep> : card;
};

function applyBackNavigation(setSelectedModel: (m: ModelInfo | null) => void, setModelFiles: (f: ModelFile[]) => void, goTo: (step: number) => void): void {
  const pending = consumePendingSpotlight();
  setSelectedModel(null);
  setModelFiles([]);
  if (pending !== null) { InteractionManager.runAfterInteractions(() => goTo(pending)); }
}

interface SortPanelProps {
  filterState: FilterState;
  setSortOption: (s: SortOption) => void;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
}
const SortPanel: React.FC<SortPanelProps> = ({ filterState, setSortOption, styles, colors }) => (
  <View style={styles.filterExpandedContent}>
    <View style={styles.filterChipWrap}>
      {SORT_OPTIONS.map(option => (
        <TouchableOpacity key={option.key} style={[styles.filterChip, filterState.sort === option.key && styles.filterChipActive]} onPress={() => setSortOption(option.key)}>
          <Icon name={option.icon} size={12} color={filterState.sort === option.key ? colors.primary : colors.textSecondary} />
          <Text style={[styles.filterChipText, filterState.sort === option.key && styles.filterChipTextActive]}>{option.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
);

export const TextModelsTab: React.FC<Props> = (props) => {
  const {
    searchQuery, setSearchQuery, isLoading, isRefreshing, hasSearched,
    selectedModel, setSelectedModel, modelFiles, setModelFiles, isLoadingFiles,
    filterState, textFiltersVisible, setTextFiltersVisible,
    filteredResults, recommendedAsModelInfo, trendingAsModelInfo, ramGB, deviceRecommendation,
    hasActiveFilters, downloadedModels,
    alertState, setAlertState, focusTrigger,
    handleSearch, handleRefresh, handleSelectModel, handleDownload, handleRepairMmProj, handleCancelDownload, handleDeleteModel,
    clearFilters, toggleFilterDimension, toggleOrg,
    setTypeFilter, setSourceFilter, setSizeFilter, setQuantFilter, setSortOption,
    isModelDownloaded, getDownloadedModel, isRepairingVisionModel,
  } = props;
  const hasNonSortActiveFilters = hasNonSortFilters(filterState);
  const currentSort = SORT_OPTIONS.find(o => o.key === filterState.sort) ?? SORT_OPTIONS[0];
  const isSortActive = filterState.sort !== 'recommended';
  const sortToggleActive = isSortActive || filterState.expandedDimension === 'sort';
  const filterToggleActive = textFiltersVisible || hasNonSortActiveFilters;

  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { goTo } = useSpotlightTour();

  const renderModelItem = ({ item, index }: { item: ModelInfo; index: number }) => (
    <ModelListItem item={item} index={index} focusTrigger={focusTrigger} isDownloaded={downloadedModels.some(m => m.id.startsWith(item.id))} isTrending={trendingAsModelInfo.some(t => t.id === item.id)} onPress={() => handleSelectModel(item)} />
  );

  const onBack = () => applyBackNavigation(setSelectedModel, setModelFiles, goTo);

  if (selectedModel) {
    return (
      <ModelDetailView
        selectedModel={selectedModel}
        modelFiles={modelFiles}
        isLoadingFiles={isLoadingFiles}
        filterState={filterState}
        ramGB={ramGB}
        alertState={alertState}
        setAlertState={setAlertState}
        onBack={onBack}
        getDownloadedModel={getDownloadedModel}
        isModelDownloaded={isModelDownloaded}
        isRepairingVisionModel={isRepairingVisionModel}
        handleDownload={handleDownload}
        handleRepairMmProj={handleRepairMmProj}
        handleCancelDownload={handleCancelDownload}
        handleDeleteModel={handleDeleteModel}
      />
    );
  }

  return (
    <>
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search Hugging Face models..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          testID="search-input"
        />
        <TouchableOpacity
          style={[styles.filterToggle, sortToggleActive && styles.filterToggleActive]}
          onPress={() => toggleFilterDimension('sort')}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          testID="sort-pill"
        >
          <Icon name={currentSort.icon} size={14} color={sortToggleActive ? colors.primary : colors.textMuted} />
          {isSortActive && <View style={styles.filterDot} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterToggle, filterToggleActive && styles.filterToggleActive]}
          onPress={() => setTextFiltersVisible(v => !v)}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          testID="text-filter-toggle"
        >
          <Icon name="sliders" size={14} color={filterToggleActive ? colors.primary : colors.textMuted} />
          {hasNonSortActiveFilters && <View style={styles.filterDot} />}
        </TouchableOpacity>
      </View>

      {filterState.expandedDimension === 'sort' && <SortPanel filterState={filterState} setSortOption={setSortOption} styles={styles} colors={colors} />}

      {textFiltersVisible && (
        <TextFiltersSection
          filterState={filterState}
          hasActiveFilters={hasNonSortActiveFilters}
          clearFilters={clearFilters}
          toggleFilterDimension={toggleFilterDimension}
          toggleOrg={toggleOrg}
          setTypeFilter={setTypeFilter}
          setSourceFilter={setSourceFilter}
          setSizeFilter={setSizeFilter}
          setQuantFilter={setQuantFilter}
        />
      )}

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading models...</Text>
        </View>
      ) : (
        <FlatList
          data={hasSearched ? filteredResults : [...(Platform.OS === 'android' ? [LITERT_RECOMMENDED_MODEL] : []), ...recommendedAsModelInfo]}
          renderItem={renderModelItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          testID="models-list"
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={hasSearched ? null : (
            <DeviceBanner ramGB={ramGB} rec={deviceRecommendation} showTitle={recommendedAsModelInfo.length > 0} styles={styles} />
          )}
          ListEmptyComponent={
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyText}>{getEmptyText(hasSearched, hasActiveFilters)}</Text>
            </Card>
          }
        />
      )}
    </>
  );
};
