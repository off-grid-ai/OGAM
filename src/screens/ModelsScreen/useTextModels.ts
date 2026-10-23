import { useState, useCallback, useMemo, useEffect } from 'react';
import { Keyboard, BackHandler } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { showAlert, hideAlert, AlertState } from '../../components/CustomAlert';
import { CATALOG, type MobileTextCatalogModel } from '@offgrid/models';
import { RECOMMENDED_MODELS, TRENDING_FAMILIES, MODEL_ORGS } from '../../constants';
import { useWithRemoteCatalog } from '../../stores/modelCatalogStore';
import { useAppStore } from '../../stores';
import { fileExceedsBudget, textModelBudget } from '../../services/memoryBudget';
import { useDownloadStore } from '../../stores/downloadStore';
import { huggingFaceService, modelManager, hardwareService, activeModelService } from '../../services';
import { startModelDownload } from '../../services/startModelDownload';
import { hfUploadNeedsNewerEngine } from '../../services/llamaEngineSupport';
import { loadsOnPhone } from '../../services/devicePicks';
import { ramFitScore } from '../../utils/recommendedModels';
import { modelSupportsNpuGpu } from '../../utils/acceleration';
import { ModelInfo, ModelFile, DownloadedModel } from '../../types';
import { FilterDimension, FilterState, ModelTypeFilter, CredibilityFilter, SizeFilter, SortOption } from './types';
import { initialFilterState, SIZE_OPTIONS, VISION_PIPELINE_TAG, CODE_FALLBACK_QUERY } from './constants';
import { getModelType } from './utils';
import logger from '../../utils/logger';
import { getUserFacingDownloadMessage } from '../../utils/downloadErrors';

const PARAM_COUNT_REGEX = /\b(\d+[.]\d+|\d+)\s?[Bb]\b/;

function parseParamCount(model: ModelInfo): number | null {
  const match = PARAM_COUNT_REGEX.exec(model.name) ?? PARAM_COUNT_REGEX.exec(model.id);
  return match ? Number.parseFloat(match[1]) : null;
}


// Resolve a model's min RAM (explicit, else ~0.75GB/B params), then score via the
// shared ramFitScore so onboarding + this screen rank fit identically.
function bestFitScore(model: ModelInfo, ramGB: number): number {
  return ramFitScore(model.minRamGB ?? (model.paramCount ?? 0) * 0.75, ramGB);
}

function applySort<T extends ModelInfo>(models: T[], sort: SortOption, ramGB = 0): T[] {
  if (sort === 'recommended') return models;
  return [...models].sort((a, b) => {
    if (sort === 'bestfit') return bestFitScore(a, ramGB) - bestFitScore(b, ramGB);
    if (sort === 'size') return (a.paramCount ?? parseParamCount(a) ?? 0) - (b.paramCount ?? parseParamCount(b) ?? 0);
    if (sort === 'downloads') return (b.downloads ?? 0) - (a.downloads ?? 0);
    const da = a.lastModified ? new Date(a.lastModified).getTime() : 0;
    const db = b.lastModified ? new Date(b.lastModified).getTime() : 0;
    return db - da;
  });
}

function matchesOrgFilter(model: ModelInfo, orgs: string[]): boolean {
  if (orgs.length === 0) return true;
  return orgs.some(orgKey => {
    if (model.author === orgKey) return true;
    const orgLabel = MODEL_ORGS.find(o => o.key === orgKey)?.label || orgKey;
    return model.id.toLowerCase().includes(orgLabel.toLowerCase()) ||
      model.name.toLowerCase().includes(orgLabel.toLowerCase());
  });
}

/** Whether a curated model passes the maker, type and size filters. */
function matchesCuratedFilters(model: MobileTextCatalogModel, filterState: FilterState): boolean {
  if (filterState.type !== 'all' && model.type !== filterState.type) return false;
  if (filterState.orgs.length > 0 && !filterState.orgs.includes(model.org)) return false;
  if (filterState.size !== 'all') {
    const sizeOpt = SIZE_OPTIONS.find(s => s.key === filterState.size);
    if (sizeOpt && (model.params < sizeOpt.min || model.params >= sizeOpt.max)) return false;
  }
  return true;
}

/** A curated model a search names: by its name, repo, maker or description. An empty search
 *  (filters only) names every model. */
function matchesCatalogSearch(query: string, model: MobileTextCatalogModel): boolean {
  const needle = query.trim().toLowerCase();
  return [model.name, model.id, model.org, model.description].some(text => text.toLowerCase().includes(needle));
}

/** A Q4_K_M download is about 4.8 bits per weight: 0.6 GB per billion parameters. */
const Q4_BYTES_PER_BILLION_PARAMS = 0.6e9;

function mapCuratedModel(m: MobileTextCatalogModel, details: Record<string, ModelInfo>): ModelInfo {
  const fetched = details[m.id];
  const curatedFields = {
    modelType: m.type, paramCount: m.params, minRamGB: m.minRam,
    ...(m.activeParams ? { activeParams: m.activeParams } : {}),
    ...(m.nonCommercial ? { nonCommercial: true } : {}),
  };
  if (fetched) return { ...fetched, name: m.name, description: m.description, ...curatedFields };
  return { id: m.id, name: m.name, author: m.id.split('/')[0], description: m.description, downloads: -1, likes: 0, tags: [], lastModified: '', files: [], ...curatedFields };
}

async function fetchRecommendedModelDetails(recommended: MobileTextCatalogModel[]): Promise<Record<string, ModelInfo>> {
  const details: Record<string, ModelInfo> = {};
  await Promise.allSettled(recommended.map(async (m) => {
    try { details[m.id] = await huggingFaceService.getModelDetails(m.id); }
    catch (e) { logger.warn(`[ModelsScreen] Failed to fetch details for ${m.id}:`, e); }
  }));
  return details;
}

function computeFilteredResults(
  searchResults: ModelInfo[],
  filterState: FilterState,
  ramGB: number,
  needsNewerEngine: (repoId: string) => boolean,
): ModelInfo[] {
  const filtered = searchResults.filter(model => {
    // An upload of a catalog model this engine cannot load is left out, as its catalog card is.
    if (needsNewerEngine(model.id)) return false;
    if (filterState.source !== 'all' && model.credibility?.source !== filterState.source) return false;
    if (filterState.type !== 'all' && getModelType(model) !== filterState.type) return false;
    if (!matchesOrgFilter(model, filterState.orgs)) return false;
    if (filterState.size !== 'all') {
      const params = parseParamCount(model);
      if (params !== null) {
        const sizeOpt = SIZE_OPTIONS.find(s => s.key === filterState.size);
        if (sizeOpt && (params < sizeOpt.min || params >= sizeOpt.max)) return false;
      }
    }
    // Only GGUF chat models get the text budget; an image-generation result keeps the strict one.
    const budget = getModelType(model) === 'image-gen' ? undefined : textModelBudget();
    const filesWithSize = (model.files || []).filter(f => f.size > 0);
    if (filesWithSize.length > 0) {
      if (!filesWithSize.some(f => !fileExceedsBudget(f.size, ramGB, budget))) return false;
    } else {
      // Search results carry no file sizes: judge by the parameter count instead, so a model that
      // is Too big for this phone is not offered at all.
      const params = model.paramCount ?? parseParamCount(model);
      if (params !== null && fileExceedsBudget(params * Q4_BYTES_PER_BILLION_PARAMS, ramGB, budget)) return false;
    }
    return true;
  });
  return filtered.map(model => {
    const type = getModelType(model);
    const params = parseParamCount(model);
    return { ...model, modelType: type === 'image-gen' ? undefined : type as 'text' | 'vision' | 'code', paramCount: params ?? undefined };
  });
}

export function useTextModels(setAlertState: (s: AlertState) => void) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchResults, setSearchResults] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [modelFiles, setModelFiles] = useState<ModelFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [filterState, setFilterState] = useState<FilterState>(initialFilterState);
  const [textFiltersVisible, setTextFiltersVisible] = useState(false);
  const [recommendedModelDetails, setRecommendedModelDetails] = useState<Record<string, ModelInfo>>({});
  const recommended = useWithRemoteCatalog('text', RECOMMENDED_MODELS);
  const catalog = useWithRemoteCatalog('models', CATALOG);
  const repairingVisionIds = useDownloadStore(s => s.repairingVisionIds);
  const setRepairingVision = useDownloadStore(s => s.setRepairingVision);

  const { downloadedModels, setDownloadedModels, removeDownloadedModel, activeModelId } = useAppStore();

  const loadDownloadedModels = async () => {
    const models = await modelManager.getDownloadedModels();
    setDownloadedModels(models);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadDownloadedModels(); }, []);

  useEffect(() => {
    let cancelled = false;
    // Details only enrich the cards: a model whose details fail keeps its catalog name, size and
    // description (recommendedAsModelInfo), so a failure is logged, not shown.
    fetchRecommendedModelDetails(recommended)
      .then(d => { if (!cancelled) setRecommendedModelDetails(d); })
      .catch(e => logger.warn('[ModelsScreen] Failed to load recommended model details:', e));
    return () => { cancelled = true; };
  }, [recommended]);

  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (selectedModel) { setSelectedModel(null); setModelFiles([]); return true; }
        return false;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => sub.remove();
    }, [selectedModel])
  );

  const runSearch = async () => {
    const hasQuery = searchQuery.trim().length > 0;
    const hasTypeFilter = filterState.type !== 'all';
    const hasOrgFilter = filterState.orgs.length > 0;
    const hasSizeFilter = filterState.size !== 'all';
    if (!hasQuery && !hasTypeFilter && !hasOrgFilter && !hasSizeFilter) {
      setHasSearched(false); setSearchResults([]); return;
    }
    let pipelineTag: string | undefined;
    let effectiveQuery = searchQuery.trim();
    if (filterState.type === 'vision') pipelineTag = VISION_PIPELINE_TAG;
    else if (filterState.type === 'code' && !effectiveQuery) effectiveQuery = CODE_FALLBACK_QUERY;
    setIsLoading(true); setHasSearched(true);
    try {
      const results = await huggingFaceService.searchModels(effectiveQuery, { limit: 30, pipelineTag });
      setSearchResults(results);
    } catch {
      setAlertState(showAlert('Search Error', 'Failed to search models. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async () => {
    Keyboard.dismiss();
    setFilterState(prev => ({ ...prev, expandedDimension: null }));
    await runSearch();
  };

  useEffect(() => {
    if (!searchQuery.trim()) { setHasSearched(false); setSearchResults([]); return; }
    const timer = setTimeout(() => { runSearch(); }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Auto-search when searchable filters change (type/size/org) even with empty query
  // Uses runSearch directly to avoid collapsing the expanded filter dimension
  useEffect(() => {
    if (filterState.type === 'all' && filterState.size === 'all' && filterState.orgs.length === 0) return;
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterState.type, filterState.size, filterState.orgs.length]);

  const handleSelectModel = async (model: ModelInfo) => {
    setSelectedModel(model); setIsLoadingFiles(true);
    // Curated entries under the offgrid/ namespace (e.g. the synthetic LiteRT
    // parent) ship with their files baked into the ModelInfo — skip the
    // HuggingFace fetch and use them as-is. Real HF models always go through
    // the fetch path even when factories/mocks pre-populate model.files.
    if (model.id.startsWith('offgrid/') && model.files && model.files.length > 0) {
      setModelFiles(model.files);
      setIsLoadingFiles(false);
      return;
    }
    try {
      const files = await huggingFaceService.getModelFiles(model.id);
      setModelFiles(files);
    } catch {
      setAlertState(showAlert('Error', 'Failed to load model files.'));
      setModelFiles([]);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleRepairMmProj = async (model: ModelInfo, file: ModelFile) => {
    const modelDownloadId = `${model.id}/${file.name}`;
    setRepairingVision(modelDownloadId, true);
    try {
      await modelManager.repairMmProj(model.id, file, {});
      await loadDownloadedModels();
      setAlertState(showAlert('Vision Repaired', `Vision file restored for ${model.name}. Reload the model to enable vision.`));
    } catch (e) {
      setAlertState(showAlert('Repair Failed', (e as Error).message));
    } finally {
      setRepairingVision(modelDownloadId, false);
    }
  };

  const isRepairingVisionModel = (modelDownloadId: string) => !!repairingVisionIds[modelDownloadId];

  const handleDownload = async (model: ModelInfo, file: ModelFile) => {
    // Shared with the onboarding ModelDownloadScreen via startModelDownload — one
    // mechanism + one duplicate guard. This screen owns only its completion/error UI.
    await startModelDownload(model.id, file, {
      autoSelectIfEmpty: true,
      onRegistered: (dm) => {
        if (file.mmProjFile && !(dm.engine === 'llama' && dm.isVisionModel)) {
          setAlertState(showAlert(
            'Model Downloaded',
            `${model.name} downloaded but the vision projection file could not be saved. Go to Download Manager and use "Repair Vision" to fix it.`,
          ));
        } else {
          // A finished download is the model you use next: make it active and offer the chat.
          activeModelService.selectTextModel(dm.id);
          setAlertState(showAlert(`${model.name} is ready`, undefined, [
            { text: 'Later', style: 'cancel' },
            { text: 'Chat now', onPress: () => { setAlertState(hideAlert()); navigation.navigate('Chat', {}); } },
          ]));
        }
      },
      onError: (err) => setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(err.message))),
    });
  };

  const handleCancelDownload = async (modelKey: string) => {
    const entry = useDownloadStore.getState().downloads[modelKey];
    if (!entry) return;
    useDownloadStore.getState().remove(modelKey);
    try {
      await modelManager.cancelBackgroundDownload(entry.downloadId);
      if (entry.mmProjDownloadId) {
        await modelManager.cancelBackgroundDownload(entry.mmProjDownloadId).catch(() => {});
      }
    } catch { /* ignore cancel errors */ }
  };

  const handleDeleteModel = (modelId: string) => {
    const model = downloadedModels.find(m => m.id === modelId);
    if (!model) return;
    const sizeMB = Math.round(hardwareService.getModelTotalSize(model) / (1024 * 1024));
    setAlertState(showAlert(
      'Delete Model',
      `Delete "${model.name}"? This will free up about ${sizeMB} MB.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          setAlertState(hideAlert());
          if (activeModelId === model.id) await activeModelService.unloadTextModel().catch(() => {});
          await modelManager.deleteModel(model.id);
          removeDownloadedModel(model.id);
        } },
      ],
    ));
  };
  // Resolve a catalog file to its on-disk model by the FILE, not the composite id.
  // The download path registers `${modelId}/${fileName}`, but the restart catch-up /
  // recovery scans register the SAME file under a different id (`recovered_…` or a bare
  // name). Matching only the composite id made a recovered quant (e.g. a Q4_0 finalized
  // after an app kill) look "not downloaded", so its file row fell through to whichever
  // sibling quant WAS registered under the expected id (the Q4_K_M) — loading the wrong
  // quant. A file name is unique within the models dir, so it's the stable key.
  const matchesFile = (m: DownloadedModel, modelId: string, fileName: string) =>
    m.fileName === fileName || m.id === `${modelId}/${fileName}`;

  const isModelDownloaded = (modelId: string, fileName: string) =>
    downloadedModels.some(m => matchesFile(m, modelId, fileName));

  const getDownloadedModel = (modelId: string, fileName: string): DownloadedModel | undefined =>
    downloadedModels.find(m => matchesFile(m, modelId, fileName));

  // Filter actions
  const clearFilters = useCallback(() => setFilterState(initialFilterState), []);
  const toggleFilterDimension = useCallback((dim: FilterDimension) => {
    setFilterState(prev => ({ ...prev, expandedDimension: prev.expandedDimension === dim ? null : dim }));
  }, []);
  const toggleOrg = useCallback((orgKey: string) => {
    setFilterState(prev => ({
      ...prev,
      orgs: prev.orgs.includes(orgKey) ? prev.orgs.filter(o => o !== orgKey) : [...prev.orgs, orgKey],
    }));
  }, []);
  const setTypeFilter = useCallback((type: ModelTypeFilter) =>
    setFilterState(prev => ({ ...prev, type, expandedDimension: null })), []);
  const setSourceFilter = useCallback((source: CredibilityFilter) =>
    setFilterState(prev => ({ ...prev, source, expandedDimension: null })), []);
  const setSizeFilter = useCallback((size: SizeFilter) =>
    setFilterState(prev => ({ ...prev, size, expandedDimension: null })), []);
  const setQuantFilter = useCallback((quant: string) =>
    setFilterState(prev => ({ ...prev, quant, expandedDimension: null })), []);
  const setSortOption = useCallback((sort: SortOption) =>
    setFilterState(prev => ({ ...prev, sort, expandedDimension: null })), []);

  // Computed
  const ramGB = hardwareService.getTotalMemoryGB();
  const deviceRecommendation = useMemo(() => hardwareService.getModelRecommendation(), []);
  // A curated model is offered when it loads on this phone by the shared fit rule (its download
  // against the phone budget); one the catalog has no size for falls back to its RAM floor.
  const fitsThisPhone = useCallback(
    (m: MobileTextCatalogModel) =>
      (loadsOnPhone(m.id, ramGB, catalog) ?? m.minRam <= ramGB) && (!m.maxRam || ramGB <= m.maxRam),
    [ramGB, catalog],
  );
  const hasActiveFilters = filterState.orgs.length > 0 || filterState.type !== 'all' ||
    filterState.source !== 'all' || filterState.size !== 'all' || filterState.quant !== 'all' ||
    filterState.sort !== 'recommended';

  const recommendedAsModelInfo = useMemo((): ModelInfo[] => {
    const models = recommended
      .filter(m => fitsThisPhone(m))
      .filter(m => matchesCuratedFilters(m, filterState))
      .map(m => mapCuratedModel(m, recommendedModelDetails));
    const sorted = applySort(models, filterState.sort, ramGB);
    // Prioritize NPU/GPU-accelerable models (LiteRT or Q4_0/Q8_0) to the top of the
    // recommended list, keeping the existing order stable within each group. Only for
    // the editorial 'recommended' sort — explicit sorts (size/downloads/…) are honored.
    if (filterState.sort !== 'recommended') return sorted;
    return [...sorted].sort((a, b) => Number(modelSupportsNpuGpu(b)) - Number(modelSupportsNpuGpu(a)));
  }, [recommended, fitsThisPhone, filterState, recommendedModelDetails, ramGB]);

  // A search lists the curated models it matches first, under the same filters and fit as the
  // curated list, then Hugging Face results, without repeating a curated model.
  const filteredResults = useMemo(() => {
    const named = new Set(recommended.filter(m => matchesCatalogSearch(searchQuery, m)).map(m => m.id));
    const fromCatalog = recommendedAsModelInfo.filter(model => named.has(model.id));
    const catalogIds = new Set(fromCatalog.map(model => model.id));
    const needsNewerEngine = hfUploadNeedsNewerEngine(catalog);
    const fromHuggingFace = applySort(computeFilteredResults(searchResults, filterState, ramGB, needsNewerEngine), filterState.sort, ramGB);
    return [...fromCatalog, ...fromHuggingFace.filter(model => !catalogIds.has(model.id))];
  }, [recommended, recommendedAsModelInfo, catalog, searchQuery, searchResults, filterState, ramGB]);

  const trendingAsModelInfo = useMemo((): ModelInfo[] => {
    // Pick the best-fit per family using the same bestFitScore used for "for you" recommendations
    return Object.values(TRENDING_FAMILIES)
      .map(ids => recommended
        .filter(m => ids.includes(m.id) && fitsThisPhone(m))
        .map(m => mapCuratedModel(m, recommendedModelDetails))
        .sort((a, b) => bestFitScore(a, ramGB) - bestFitScore(b, ramGB))[0])
      .filter((m): m is ModelInfo => Boolean(m));
  }, [recommended, fitsThisPhone, recommendedModelDetails, ramGB]);

  return {
    searchQuery, setSearchQuery,
    isLoading, isRefreshing, setIsRefreshing,
    hasSearched,
    selectedModel, setSelectedModel,
    modelFiles, setModelFiles,
    isLoadingFiles,
    filterState, setFilterState,
    textFiltersVisible, setTextFiltersVisible,
    downloadedModels,
    hasActiveFilters, ramGB, deviceRecommendation,
    filteredResults, recommendedAsModelInfo, trendingAsModelInfo,
    handleSearch, handleSelectModel, handleDownload, handleRepairMmProj, handleCancelDownload, handleDeleteModel, loadDownloadedModels,
    clearFilters, toggleFilterDimension, toggleOrg,
    setTypeFilter, setSourceFilter, setSizeFilter, setQuantFilter, setSortOption,
    isModelDownloaded, getDownloadedModel, isRepairingVisionModel,
  };
}
