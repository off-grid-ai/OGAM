/**
 * The advanced setting controls for the in-chat Generation Settings modal are the
 * SHARED sections used by the Model Settings screen too — re-exported here so the
 * modal's TextGenerationSection keeps its import path while there is only one
 * implementation. See ../settings/textGenAdvancedSections.
 */
export {
  BackendSelector,
  LiteRTBackendSelector,
  FlashAttentionToggle,
  KvCacheTypeToggle,
  CpuThreadsSlider,
  BatchSizeSlider,
  ModelLoadingModeSelector,
  ShowGenerationDetailsToggle,
} from '../settings/textGenAdvancedSections';
