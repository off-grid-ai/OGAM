import React, { useEffect } from 'react';
import { View, Text, FlatList, TextInput, ActivityIndicator, RefreshControl, TouchableOpacity, InteractionManager, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AttachStep, useSpotlightTour } from 'react-native-spotlight-tour';
import { Card, ModelCard } from '../../components';
import { AnimatedEntry } from '../../components/AnimatedEntry';
import { CustomAlert, hideAlert } from '../../components/CustomAlert';
import { consumePendingSpotlight, peekPendingSpotlight, setPendingSpotlight } from '../../components/onboarding/spotlightState';
import { DOWNLOAD_MANAGER_STEP_INDEX } from '../../components/onboarding/spotlightConfig';
import { useTheme, useThemedStyles } from '../../theme';
import { needsVisionRepair as checkNeedsVisionRepair } from '../../utils/visionRepair';
import { CREDIBILITY_LABELS } from '../../constants';
import { ModelInfo, ModelFile } from '../../types';
import { createStyles } from './styles';
import { ModelsScreenViewModel } from './useModelsScreen';
import { useDownloadStore, isActiveStatus } from '../../stores/downloadStore';
import { makeModelKey } from '../../utils/modelKey';
import { TextFiltersSection } from './TextFiltersSection';
import { FilterState, SortOption } from './types';
import { SORT_OPTIONS } from './constants';
import { formatNumber, getTextModelCompatibility } from './utils';

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
    const canCancel = !!entry && isActiveStatus(entry.status);
    return { downloadKey: modelKey, progress, downloaded, downloadedModel, needsVisionRepair, repairingVision, canCancel };
  };

  const renderFileItem = ({ item, index }: { item: ModelFile; index: number }) => {
    const s = getFileCardState(item);
    const onDownload = !s.downloaded && !s.progress ? () => {
      handleDownload(selectedModel, item);
      if (peekPendingSpotlight() !== null) setTimeout(onBack, 800);
    } : undefined;
    const card = (
      <ModelCard
        model={{ id: selectedModel.id, name: item.name.replace('.gguf', ''), author: selectedModel.author, credibility: selectedModel.credibility }}
        file={item} downloadedModel={s.downloadedModel} isDownloaded={s.downloaded}
        isDownloading={!!s.progress} downloadProgress={s.progress?.progress}
        downloadBytes={s.progress ? { downloaded: s.progress.bytesDownloaded, total: s.progress.totalBytes } : undefined}
        isRepairingVision={s.repairingVision}
        isCompatible={item.size / (1024 ** 3) < ramGB * 0.6} testID={`file-card-${index}`}
        onDownload={onDownload}
        onDelete={s.downloaded ? () => handleDeleteModel(`${selectedModel.id}/${item.name}`) : undefined}
        onRepairVision={s.needsVisionRepair && !s.progress && !s.repairingVision ? () => handleRepairMmProj(selectedModel, item) : undefined}
        onCancel={s.canCancel ? () => handleCancelDownload(s.downloadKey) : undefined}
      />
    );
    return index === 0 ? <AttachStep index={9} fill>{card}</AttachStep> : card;
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
        <View style={styles.modelStats}>
          <Text style={styles.statText}>{formatNumber(selectedModel.downloads)} downloads</Text>
          <Text style={styles.statText}>{formatNumber(selectedModel.likes)} likes</Text>
        </View>
      </Card>
      <Text style={styles.sectionTitle}>Available Files</Text>
      <Text style={styles.sectionSubtitle}>
        Choose a quantization level. Q4_K_M is recommended for mobile.
        {modelFiles.some(f => f.mmProjFile) && ' Vision files include mmproj.'}
      </Text>
      {isLoadingFiles ? (
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <FlatList
          data={modelFiles
            .filter(f => f.size > 0 && f.size / (1024 ** 3) < ramGB * 0.6 && (filterState.quant === 'all' || f.name.includes(filterState.quant)))
            .sort((a, b) => {
              const aRec = a.name.includes('Q4_K_M') ? 0 : 1;
              const bRec = b.name.includes('Q4_K_M') ? 0 : 1;
              if (aRec !== bRec) return aRec - bRec;
              return b.size - a.size;
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

const LITERT_FEATURED = [
  {
    id: 'gemma4-e2b-litert',
    name: 'Gemma 4 E2B',
    author: 'google',
    description: 'Google\'s latest, thinking mode + vision, MoE architecture',
    chips: ['NPU / GPU', 'Vision', 'Thinking', '~1.5 GB'],
    highlight: 'Up to 2x faster than CPU via NPU hardware acceleration',
    url: 'https://huggingface.co/google/gemma-4-E2B-it-litert-lm',
  },
  {
    id: 'gemma4-e4b-litert',
    name: 'Gemma 4 E4B',
    author: 'google',
    description: 'Stronger reasoning + vision, MoE fits more in less RAM',
    chips: ['NPU / GPU', 'Vision', 'Thinking', '~3.5 GB'],
    highlight: 'Higher quality, same hardware efficiency as E2B',
    url: 'https://huggingface.co/google/gemma-4-E4B-it-litert-lm',
  },
] as const;

const FeaturedLiteRTCard: React.FC<{ model: typeof LITERT_FEATURED[number]; styles: any; colors: any }> = ({ model, styles, colors }) => (
  <TouchableOpacity
    style={styles.featuredCard}
    onPress={() => Linking.openURL(model.url)}
    activeOpacity={0.85}
  >
    <View style={styles.featuredCardTopRow}>
      <View style={styles.featuredCardNameGroup}>
        <Text style={styles.featuredCardName}>{model.name}</Text>
        <View style={styles.featuredAuthorTag}>
          <Text style={styles.featuredAuthorTagText}>{model.author}</Text>
        </View>
        <View style={styles.featuredBadge}>
          <Icon name="zap" size={9} color={colors.primary} />
          <Text style={styles.featuredBadgeText}>LiteRT</Text>
        </View>
      </View>
    </View>
    <Text style={styles.featuredDescription}>{model.description}</Text>
    <View style={styles.featuredChipsRow}>
      {model.chips.map(chip => (
        <View key={chip} style={styles.featuredChip}>
          <Text style={styles.featuredChipText}>{chip}</Text>
        </View>
      ))}
    </View>
    <View style={styles.featuredFooter}>
      <Text style={styles.featuredHighlight}>{model.highlight}</Text>
      <View style={styles.featuredGetButton}>
        <Icon name="download" size={12} color={colors.primary} />
        <Text style={styles.featuredGetText}>Get</Text>
      </View>
    </View>
  </TouchableOpacity>
);

const FeaturedLiteRTSection: React.FC<{ styles: any; colors: any }> = ({ styles, colors }) => (
  <View style={styles.featuredSection}>
    <Text style={styles.featuredSectionLabel}>Hardware-accelerated</Text>
    {LITERT_FEATURED.map(model => (
      <FeaturedLiteRTCard key={model.id} model={model} styles={styles} colors={colors} />
    ))}
  </View>
);

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
  const card = (<AnimatedEntry index={index} staggerMs={30} trigger={focusTrigger}><ModelCard model={item} isDownloaded={isDownloaded} isCompatible={isCompatible} incompatibleReason={incompatibleReason} onPress={isCompatible ? onPress : undefined} testID={`model-card-${index}`} compact isTrending={isTrending} /></AnimatedEntry>);
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
          data={hasSearched ? filteredResults : recommendedAsModelInfo}
          renderItem={renderModelItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          testID="models-list"
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={hasSearched ? null : (
            <>
              <FeaturedLiteRTSection styles={styles} colors={colors} />
              <DeviceBanner ramGB={ramGB} rec={deviceRecommendation} showTitle={recommendedAsModelInfo.length > 0} styles={styles} />
            </>
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
