import {
  useState,
  useCallback,
  useDeferredValue,
  useMemo,
  useEffect,
  useRef,
} from 'react';
import { Keyboard, BackHandler } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { showAlert, AlertState } from '../../components/CustomAlert';
import { useAppStore } from '../../stores';
import {
  hardwareService,
  huggingFaceService,
  modelLibrary,
} from '../../services';
import { startModelDownload } from '../../services/startModelDownload';
import { applicationFacade } from '../../services/applicationFacade';
import { useModelDownloadsProjection } from '../../hooks/useModelDownloadsProjection';
import { modelSupportsNpuGpu } from '../../utils/acceleration';
import { ModelInfo, ModelFile, DownloadedModel } from '../../types';
import {
  FilterDimension,
  FilterState,
  ModelTypeFilter,
  CredibilityFilter,
  SizeFilter,
  SortOption,
} from './types';
import {
  initialFilterState,
  SIZE_OPTIONS,
  VISION_PIPELINE_TAG,
  CODE_FALLBACK_QUERY,
} from './constants';
import logger from '../../utils/logger';
import { getUserFacingDownloadMessage } from '../../utils/downloadErrors';
import { downloadedModelMatchesFile, modelDownloadMatchesFile } from './modelDownloadProjection';
import {
  catalogModelFiles,
  resolveModelFiles,
} from '../../services/modelCatalogFiles';
import {
  LITERT_PARENT_ID,
  MODEL_ORGS,
  RECOMMENDED_MODELS,
  prioritizeAccelerated,
  queryCatalogModels,
  recommendedCatalogModels,
  trendingCatalogModels,
  modelsFailureMessage,
} from '@offgrid/application';
function mapCuratedModel(
  m: (typeof RECOMMENDED_MODELS)[number],
  details: Record<string, ModelInfo>,
): ModelInfo {
  const fetched = details[m.id];
  const catalogFiles = catalogModelFiles(m.id) ?? [];
  const curatedFields = {
    modelType: m.type,
    paramCount: m.params,
    minRamGB: m.minRam,
    files: catalogFiles,
  };
  if (fetched)
    return {
      ...fetched,
      name: m.name,
      description: m.description,
      ...curatedFields,
    };
  return {
    id: m.id,
    name: m.name,
    author: m.id.split('/')[0],
    description: m.description,
    downloads: -1,
    likes: 0,
    tags: [],
    lastModified: '',
    ...curatedFields,
  };
}

async function fetchRecommendedModelDetails(): Promise<
  Record<string, ModelInfo>
> {
  const details: Record<string, ModelInfo> = {};
  await Promise.allSettled(
    RECOMMENDED_MODELS.map(async m => {
      try {
        details[m.id] = await huggingFaceService.getModelDetails(m.id);
      } catch (e) {
        logger.warn(`[ModelsScreen] Failed to fetch details for ${m.id}:`, e);
      }
    }),
  );
  return details;
}
function useCatalogCollections(input: {
  filterState: FilterState;
  searchResults: ModelInfo[];
  recommendedModelDetails: Record<string, ModelInfo>;
}) {
  const { filterState, searchResults, recommendedModelDetails } = input;
  const ramGB = hardwareService.getTotalMemoryGB();
  const deviceRecommendation = useMemo(
    () => hardwareService.getModelRecommendation(),
    [],
  );
  const hasActiveFilters =
    filterState.orgs.length > 0 ||
    filterState.type !== 'all' ||
    filterState.source !== 'all' ||
    filterState.size !== 'all' ||
    filterState.quant !== 'all' ||
    filterState.sort !== 'recommended';
  const filteredResults = useMemo(
    () =>
      queryCatalogModels({
        models: searchResults,
        state: filterState,
        ramGb: ramGB,
        organizations: MODEL_ORGS,
      }),
    [searchResults, filterState, ramGB],
  );
  const recommendedAsModelInfo = useMemo((): ModelInfo[] => {
    const size =
      filterState.size === 'all'
        ? null
        : SIZE_OPTIONS.find(option => option.key === filterState.size) ?? null;
    const models = recommendedCatalogModels({
      maxParams: deviceRecommendation.maxParameters,
      ramGb: ramGB,
      type: filterState.type,
      orgs: filterState.orgs,
      size,
    }).map(model => mapCuratedModel(model, recommendedModelDetails));
    const sorted = queryCatalogModels({
      models,
      state: {
        ...filterState,
        orgs: [],
        type: 'all',
        source: 'all',
        size: 'all',
        quant: 'all',
      },
      ramGb: ramGB,
    });
    return filterState.sort === 'recommended'
      ? prioritizeAccelerated(sorted, modelSupportsNpuGpu)
      : sorted;
  }, [
    deviceRecommendation.maxParameters,
    filterState,
    recommendedModelDetails,
    ramGB,
  ]);
  const trendingAsModelInfo = useMemo(
    () =>
      trendingCatalogModels({
        maxParams: deviceRecommendation.maxParameters,
        ramGb: ramGB,
      }).map(model => mapCuratedModel(model, recommendedModelDetails)),
    [deviceRecommendation.maxParameters, recommendedModelDetails, ramGB],
  );
  return {
    ramGB,
    deviceRecommendation,
    hasActiveFilters,
    filteredResults,
    recommendedAsModelInfo,
    trendingAsModelInfo,
  };
}

// Resolve a catalog file to its on-disk model by the FILE, not the composite id: the
export function useTextModels(setAlertState: (s: AlertState) => void) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchResults, setSearchResults] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [modelFiles, setModelFiles] = useState<ModelFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [filterState, setFilterState] =
    useState<FilterState>(initialFilterState);
  const [textFiltersVisible, setTextFiltersVisible] = useState(false);
  const [recommendedModelDetails, setRecommendedModelDetails] = useState<
    Record<string, ModelInfo>
  >({});
  const [repairingVisionIds, setRepairingVisionIds] = useState<Record<string, boolean>>({});
  const setRepairingVision = useCallback((id: string, repairing: boolean) => {
    setRepairingVisionIds(current => {
      if (repairing) return { ...current, [id]: true };
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);
  const modelDownloads = useModelDownloadsProjection();

  // Narrow selectors: no whole-store subscription while the user is typing.
  const downloadedModels = useAppStore(state => state.downloadedModels);
  const setDownloadedModels = useAppStore(state => state.setDownloadedModels);

  // Monotonic op id: an in-flight search resolving after a newer one is discarded.
  const searchOperationRef = useRef(0);

  const loadDownloadedModels = useCallback(async () => {
    const models = await modelLibrary.getDownloadedModels();
    setDownloadedModels(models);
  }, [setDownloadedModels]);

  useEffect(() => {
    loadDownloadedModels();
    // The model library is the lifecycle owner; this hydration runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchRecommendedModelDetails().then(d => {
      if (!cancelled) setRecommendedModelDetails(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (selectedModel) {
          setSelectedModel(null);
          setModelFiles([]);
          return true;
        }
        return false;
      };
      const sub = BackHandler.addEventListener(
        'hardwareBackPress',
        onBackPress,
      );
      return () => sub.remove();
    }, [selectedModel]),
  );

  const runSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      const hasQuery = trimmed.length > 0;
      const hasTypeFilter = filterState.type !== 'all';
      const hasOrgFilter = filterState.orgs.length > 0;
      const hasSizeFilter = filterState.size !== 'all';
      if (!hasQuery && !hasTypeFilter && !hasOrgFilter && !hasSizeFilter) {
        // Clearing supersedes anything already in flight, or a slow earlier request
        // would land and repopulate a list the user has just emptied.
        searchOperationRef.current += 1;
        setHasSearched(false);
        setSearchResults([]);
        return;
      }
      let pipelineTag: string | undefined;
      let effectiveQuery = trimmed;
      if (filterState.type === 'vision') pipelineTag = VISION_PIPELINE_TAG;
      else if (filterState.type === 'code' && !effectiveQuery)
        effectiveQuery = CODE_FALLBACK_QUERY;
      const operationId = ++searchOperationRef.current;
      setIsLoading(true);
      setHasSearched(true);
      try {
        const results = await huggingFaceService.searchModels(effectiveQuery, {
          limit: 30,
          pipelineTag,
        });
        if (operationId !== searchOperationRef.current) return;
        setSearchResults(results);
      } catch {
        if (operationId !== searchOperationRef.current) return;
        setAlertState(
          showAlert(
            'Search Error',
            'Failed to search models. Please try again.',
          ),
        );
      } finally {
        if (operationId === searchOperationRef.current) setIsLoading(false);
      }
    },
    [filterState, setAlertState],
  );

  const handleSearch = useCallback(async () => {
    Keyboard.dismiss();
    setFilterState(prev => ({ ...prev, expandedDimension: null }));
    await runSearch(searchQuery);
  }, [runSearch, searchQuery]);

  // The field stays immediate (local state — a keystroke touches no store, AsyncStorage,
  // native bridge or network); the Hugging Face debounce is keyed off the DEFERRED query,
  // so the character paints before the search is scheduled.
  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    if (!deferredSearchQuery.trim()) {
      // Supersede any in-flight request before emptying the list.
      searchOperationRef.current += 1;
      setHasSearched(false);
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      runSearch(deferredSearchQuery);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredSearchQuery]);

  // Uses runSearch directly to avoid collapsing the expanded filter dimension
  useEffect(() => {
    if (
      filterState.type === 'all' &&
      filterState.size === 'all' &&
      filterState.orgs.length === 0
    )
      return;
    runSearch(searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterState.type, filterState.size, filterState.orgs.length]);

  const handleSelectModel = useCallback(async (model: ModelInfo) => {
    setSelectedModel(model);
    setIsLoadingFiles(true);
    try {
      // LiteRT is a synthetic runtime-owned parent. Repository-backed models use
      // remote discovery so their detail screen includes every quantization; the
      // Shared catalog stays the trusted fallback inside resolveModelFiles.
      const files = model.id === LITERT_PARENT_ID
        ? model.files ?? []
        : await resolveModelFiles(model.id, huggingFaceService);
      setModelFiles(files);
    } catch {
      setAlertState(showAlert('Error', 'Failed to load model files.'));
      setModelFiles([]);
    } finally {
      setIsLoadingFiles(false);
    }
  }, [setAlertState]);

  const handleRepairMmProj = useCallback(async (model: ModelInfo, file: ModelFile) => {
    const modelDownloadId = `${model.id}/${file.name}`;
    setRepairingVision(modelDownloadId, true);
    try {
      const result = await modelLibrary.executeVisionRepair({
        type: 'repair-projector',
        modelId: model.id,
        file,
      });
      if (result.status === 'failed') throw new Error(result.error);
      if (result.status === 'installed-reconciliation-pending')
        return setAlertState(showAlert('Vision Installed', result.message));
      setAlertState(
        showAlert(
          'Vision Repaired',
          `Vision file restored for ${model.name}. Reload the model to enable vision.`,
        ),
      );
    } catch (e) {
      setAlertState(showAlert('Repair Failed', (e as Error).message));
    } finally {
      setRepairingVision(modelDownloadId, false);
    }
  }, [setAlertState, setRepairingVision]);

  const isRepairingVisionModel = useCallback(
    (modelDownloadId: string) => !!repairingVisionIds[modelDownloadId],
    [repairingVisionIds],
  );

  const handleDownload = useCallback(async (model: ModelInfo, file: ModelFile) => {
    // Shared publishes preparation, transfer, and completion reactively. This action only queues
    // the selected source and reports an admission failure.
    await startModelDownload(model.id, file, {
      onError: err =>
        setAlertState(
          showAlert(
            'Download Failed',
            getUserFacingDownloadMessage(err.message),
          ),
        ),
    });
  }, [setAlertState]);

  const handleCancelDownload = useCallback(async (modelKey: string) => {
    const download = modelDownloads.find(row =>
      modelDownloadMatchesFile(
        row,
        modelKey.slice(0, modelKey.lastIndexOf('/')),
        modelKey.slice(modelKey.lastIndexOf('/') + 1),
      ),
    );
    if (!download) return;
    const outcome = await applicationFacade().models.control({
      type: 'cancel-download',
      modelId: download.downloadId,
    });
    if (!outcome.ok) {
      setAlertState(showAlert('Cancel Failed', modelsFailureMessage(outcome.failure)));
    }
  }, [modelDownloads, setAlertState]);

  const handleDeleteModel = useCallback(
    async (modelId: string) => {
      if (!downloadedModels.some(model => model.id === modelId)) return;
      const outcome = await applicationFacade().models.remove(modelId);
      if (!outcome.ok) {
        setAlertState(showAlert('Delete Failed', modelsFailureMessage(outcome.failure)));
      }
    },
    [downloadedModels, setAlertState],
  );
  const isModelDownloaded = useCallback(
    (modelId: string, fileName: string) =>
      downloadedModels.some(m => downloadedModelMatchesFile(m, modelId, fileName)),
    [downloadedModels],
  );

  const getDownloadedModel = useCallback(
    (modelId: string, fileName: string): DownloadedModel | undefined =>
      downloadedModels.find(m => downloadedModelMatchesFile(m, modelId, fileName)),
    [downloadedModels],
  );

  // Filter actions. Every value setter collapses the expanded dimension, so that rule
  // lives once in patchFilter instead of being repeated per setter.
  const clearFilters = useCallback(() => setFilterState(initialFilterState), []);
  const toggleFilterDimension = useCallback((dim: FilterDimension) => {
    setFilterState(prev => ({
      ...prev,
      expandedDimension: prev.expandedDimension === dim ? null : dim,
    }));
  }, []);
  const toggleOrg = useCallback((orgKey: string) => {
    setFilterState(prev => ({
      ...prev,
      orgs: prev.orgs.includes(orgKey)
        ? prev.orgs.filter(o => o !== orgKey)
        : [...prev.orgs, orgKey],
    }));
  }, []);
  const patchFilter = useCallback(
    (patch: Partial<FilterState>) =>
      setFilterState(prev => ({ ...prev, ...patch, expandedDimension: null })),
    [],
  );
  const setTypeFilter = useCallback((type: ModelTypeFilter) => patchFilter({ type }), [patchFilter]);
  const setSourceFilter = useCallback((source: CredibilityFilter) => patchFilter({ source }), [patchFilter]);
  const setSizeFilter = useCallback((size: SizeFilter) => patchFilter({ size }), [patchFilter]);
  const setQuantFilter = useCallback((quant: string) => patchFilter({ quant }), [patchFilter]);
  const setSortOption = useCallback((sort: SortOption) => patchFilter({ sort }), [patchFilter]);

  const {
    ramGB,
    deviceRecommendation,
    hasActiveFilters,
    filteredResults,
    recommendedAsModelInfo,
    trendingAsModelInfo,
  } = useCatalogCollections({
    filterState,
    searchResults,
    recommendedModelDetails,
  });

  return {
    searchQuery, setSearchQuery, isLoading, isRefreshing, setIsRefreshing,
    hasSearched, selectedModel, setSelectedModel, modelFiles, setModelFiles,
    isLoadingFiles, filterState, setFilterState, textFiltersVisible,
    setTextFiltersVisible, downloadedModels, hasActiveFilters, ramGB,
    deviceRecommendation, filteredResults, recommendedAsModelInfo,
    trendingAsModelInfo, handleSearch, handleSelectModel, handleDownload,
    handleRepairMmProj, handleCancelDownload, handleDeleteModel,
    loadDownloadedModels, clearFilters, toggleFilterDimension, toggleOrg,
    setTypeFilter, setSourceFilter, setSizeFilter, setQuantFilter,
    setSortOption, isModelDownloaded, getDownloadedModel,
    isRepairingVisionModel,
  };
}
