/**
 * Advanced text-generation setting sections — the SINGLE shared implementation
 * used by BOTH the Model Settings screen and the in-chat Generation Settings
 * modal. Previously each surface hand-rolled these (two copies of the backend
 * selector, KV-cache toggle, etc.) which drifted in copy, labels, and spacing.
 *
 * Presentation: the pill-button design (segmented control). Data + behavior come
 * from the single useTextGenerationAdvanced hook + useAppStore, so the values and
 * the residency/cache logic are already single-source; this collapses the VIEW to
 * match. Adding a new backend or setting means editing ONE place.
 */
import React, { useEffect, useState } from 'react';
import { Platform, View, Text } from 'react-native';
import { SliderSetting } from '../SliderSetting';
import { useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { CacheType, InferenceBackend, LiteRTBackend, INFERENCE_BACKENDS } from '../../types';
import {
  useTextGenerationAdvanced,
  CACHE_TYPE_DESCRIPTIONS,
  GPU_LAYERS_MAX,
  CACHE_TYPE_OPTIONS,
} from '../../hooks/useTextGenerationAdvanced';
import { hardwareService } from '../../services/hardware';
import {
  REASONING_BUDGET_AUTO,
  REASONING_BUDGET_OPTIONS,
  reasoningBudgetLabel,
} from '@offgrid/models';
import { HTP_ENABLED as HTP_UI_ENABLED } from '../../config/featureFlags';
import { createTextGenAdvancedStyles } from './textGenAdvancedStyles';
import { SegmentedRow, BOOL_OPTIONS, type PillOption } from './segmentedRow';

const isAndroid = Platform.OS === 'android';

// ─── Inference Backend ─────────────────────────────────────────────────────────

type BackendOption = { id: InferenceBackend; label: string; desc: string };

const IOS_BACKENDS: BackendOption[] = [
  { id: INFERENCE_BACKENDS.CPU, label: 'CPU', desc: 'Always available. Stable, predictable performance.' },
  { id: INFERENCE_BACKENDS.METAL, label: 'Metal', desc: 'Offload layers to GPU via Metal. Faster for larger models. Requires model reload.' },
];

const ANDROID_BASE_BACKENDS: BackendOption[] = [
  { id: INFERENCE_BACKENDS.CPU, label: 'CPU', desc: 'Always available. Stable, predictable performance.' },
  // Display label 'GPU' (users don't know OpenCL); id stays OPENCL.
  { id: INFERENCE_BACKENDS.OPENCL, label: 'GPU', desc: 'Offload layers to GPU via OpenCL. Fast decode on Adreno/Mali GPUs. Requires model reload.' },
];

const HTP_BACKEND: BackendOption = {
  id: INFERENCE_BACKENDS.HTP,
  label: 'NPU (Beta)',
  desc: 'Experimental — works best with Llama- and Qwen-style models. Some models (e.g. Gemma) fall back to CPU or produce invalid output. Requires model reload.',
};

export const BackendSelector: React.FC = () => {
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const { settings, updateSettings } = useAppStore();
  const { gpuLayersEffective } = useTextGenerationAdvanced();
  const [hasNPU, setHasNPU] = useState(false);

  useEffect(() => {
    if (isAndroid) {
      hardwareService.getSoCInfo().then(info => setHasNPU(info.hasNPU));
    }
  }, []);

  const androidBackends = hasNPU && HTP_UI_ENABLED ? [...ANDROID_BASE_BACKENDS, HTP_BACKEND] : ANDROID_BASE_BACKENDS;
  const backends: BackendOption[] = Platform.OS === 'ios' ? IOS_BACKENDS : androidBackends;

  const defaultBackend = Platform.OS === 'ios' ? INFERENCE_BACKENDS.METAL : INFERENCE_BACKENDS.CPU;
  const current = settings.inferenceBackend ?? defaultBackend;
  const showLayers = current !== INFERENCE_BACKENDS.CPU;
  const layersLabel = current === INFERENCE_BACKENDS.HTP
    ? 'NPU Layers'
    : current === INFERENCE_BACKENDS.METAL ? 'GPU Layers (Metal)' : 'GPU Layers (OpenCL)';

  return (
    <SegmentedRow<InferenceBackend>
      label="Inference Backend"
      description={backends.find(b => b.id === current)?.desc ?? ''}
      options={backends}
      current={current}
      onSelect={(id) => updateSettings({ inferenceBackend: id })}
      testIdFor={(id) => `backend-${id}-button`}
    >
      {showLayers && (
        <View style={styles.layersInline}>
          <SliderSetting
            testID="gpu-layers-stepper"
            label={layersLabel}
            description="Layers offloaded to GPU. Higher = faster but may crash on low-VRAM devices. Requires model reload."
            value={gpuLayersEffective}
            min={1} max={GPU_LAYERS_MAX} step={1}
            onChange={(value) => updateSettings({ gpuLayers: value })}
          />
        </View>
      )}
    </SegmentedRow>
  );
};

// ─── LiteRT Acceleration ─────────────────────────────────────────────────────

const LITERT_BACKENDS: { id: LiteRTBackend; label: string; desc: string }[] = [
  { id: 'gpu', label: 'GPU', desc: 'Run on GPU via OpenCL. Best performance on most devices.' },
  { id: 'cpu', label: 'CPU', desc: 'Always available. Use for battery savings or thermal relief.' },
];

export const LiteRTBackendSelector: React.FC = () => {
  const { settings, updateSettings } = useAppStore();
  const current = settings.liteRTBackend ?? 'gpu';
  return (
    <SegmentedRow<LiteRTBackend>
      label="Acceleration"
      description={LITERT_BACKENDS.find(b => b.id === current)?.desc ?? ''}
      options={LITERT_BACKENDS}
      current={current}
      onSelect={(id) => updateSettings({ liteRTBackend: id })}
      testIdFor={(id) => `litert-backend-${id}-button`}
    />
  );
};

// ─── Flash Attention ──────────────────────────────────────────────────────────

/** Lives in its own module for the file-size budget; re-exported so every surface keeps ONE
 *  import path for the advanced text-generation controls. */
export { SpeculativeDecodingToggle } from './SpeculativeDecodingToggle';

export const FlashAttentionToggle: React.FC = () => {
  const { updateSettings } = useAppStore();
  const { isFlashAttnOn, handleFlashAttnToggle } = useTextGenerationAdvanced();
  return (
    <SegmentedRow<'off' | 'on'>
      label="Flash Attention"
      description="Faster inference and lower memory. Required for quantized KV cache (q8_0/q4_0). Requires model reload."
      options={BOOL_OPTIONS}
      current={isFlashAttnOn ? 'on' : 'off'}
      onSelect={(id) => (id === 'on' ? updateSettings({ flashAttn: true }) : handleFlashAttnToggle(false))}
      testIdFor={(id) => `flash-attn-${id}-button`}
    />
  );
};

// ─── KV Cache Type ───────────────────────────────────────────────────────────

export const KvCacheTypeToggle: React.FC = () => {
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const { isFlashAttnOn, cacheDisabled, displayCacheType, handleCacheTypeChange } = useTextGenerationAdvanced();
  return (
    <SegmentedRow<CacheType>
      label="KV Cache Type"
      description={CACHE_TYPE_DESCRIPTIONS[displayCacheType]}
      options={CACHE_TYPE_OPTIONS.map((ct: CacheType) => ({ id: ct, label: ct }))}
      current={displayCacheType}
      onSelect={handleCacheTypeChange}
      testIdFor={(ct) => `cache-type-${ct}-button`}
      isDisabled={(ct) => cacheDisabled && ct !== 'f16'}
    >
      {!isFlashAttnOn && (
        <Text style={styles.warning}>
          Quantized cache (q8_0/q4_0) will auto-enable flash attention.
        </Text>
      )}
    </SegmentedRow>
  );
};

// ─── Aggressive Loading ───────────────────────────────────────────────────────

/**
 * Reads/writes the single `settings.aggressiveModelLoading` source of truth (the
 * residency manager is driven off it by loadPolicySync). Shared by the llama and
 * LiteRT panels on both surfaces.
 */
type ModelLoadingMode = 'conservative' | 'balanced' | 'aggressive';
const MODE_OPTIONS: PillOption<ModelLoadingMode>[] = [
  // Label is "Lean" (short enough to sit on one line in the 3-segment row); the underlying policy
  // id stays 'conservative' so nothing downstream changes.
  { id: 'conservative', label: 'Lean' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'aggressive', label: 'Aggressive' },
];

export const ModelLoadingModeSelector: React.FC = () => {
  const { settings, updateSettings } = useAppStore();
  // Single source of truth: the 3-mode setting, falling back to the legacy boolean.
  const current: ModelLoadingMode =
    settings.modelLoadingMode ?? (settings.aggressiveModelLoading ? 'aggressive' : 'balanced');
  return (
    <SegmentedRow<ModelLoadingMode>
      label="Model Loading"
      description="Lean keeps ONE model in memory at a time. Balanced keeps models loaded together when they fit and swaps when they do not. Aggressive commits a larger share of RAM so bigger models load. You can always Load Anyway if a model is refused."
      options={MODE_OPTIONS}
      current={current}
      onSelect={(id) => updateSettings({ modelLoadingMode: id })}
      testIdFor={(id) => `model-loading-mode-${id}-button`}
    />
  );
};

// ─── Thinking Budget ─────────────────────────────────────────────────────────

// Values AND labels come from the shared @offgrid/models contract so OGAD and OGAM render
// identical options. Only the "tokens" suffix is trimmed: six pills share one row here, so the
// pill shows the number ("512", "2K") and the description carries the unit.
const THINKING_BUDGET_OPTIONS: PillOption<string>[] = [
  { id: String(REASONING_BUDGET_AUTO), label: 'Auto' },
  ...REASONING_BUDGET_OPTIONS.map(v => ({
    id: String(v),
    label: reasoningBudgetLabel(v).replace(' tokens', ''),
  })),
];

/** llama.rn path only: the cap rides the completion request as thinking_budget_tokens
 *  (shared rule: @offgrid/models thinkingBudgetPayload). LiteRT has no thinking channel. */
export const ThinkingBudgetSelector: React.FC = () => {
  const { settings, updateSettings } = useAppStore();
  const current = String(settings.reasoningBudget ?? REASONING_BUDGET_AUTO);
  return (
    <SegmentedRow<string>
      label="Thinking Budget"
      description="Auto lets the model think for as long as it needs. A cap ends the thinking at that many tokens so the answer arrives sooner. Applies when Thinking is on."
      options={THINKING_BUDGET_OPTIONS}
      current={current}
      onSelect={(id) => updateSettings({ reasoningBudget: Number(id) })}
      testIdFor={(id) => `thinking-budget-${id}-button`}
    />
  );
};

// ─── Show Generation Details ──────────────────────────────────────────────────

export const ShowGenerationDetailsToggle: React.FC = () => {
  const { settings, updateSettings } = useAppStore();
  const on = !!settings.showGenerationDetails;
  return (
    <SegmentedRow<'off' | 'on'>
      label="Show Generation Details"
      description="Show context use, model, speed, and image settings below each reply"
      options={BOOL_OPTIONS}
      current={on ? 'on' : 'off'}
      onSelect={(id) => updateSettings({ showGenerationDetails: id === 'on' })}
      testIdFor={(id) => `show-gen-details-${id}-button`}
    />
  );
};

// ─── CPU Threads & Batch Size ────────────────────────────────────────────────

export const CpuThreadsSlider: React.FC = () => {
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const { updateSettings } = useAppStore();
  const { cpuThreadsSliderValue, cpuThreadsDisplayValue } = useTextGenerationAdvanced();
  return (
    <View style={styles.container}>
      <SliderSetting
        testID="cpu-threads-stepper"
        label="CPU Threads"
        description="Parallel threads for inference"
        value={cpuThreadsSliderValue}
        // Unset means AUTO, and the slider's own minimum is 1 — so the screen read "1" while the
        // engine was running the hardware-recommended count. Show what will actually be used.
        formatValue={() => cpuThreadsDisplayValue}
        min={1} max={12} step={1}
        onChange={(v) => updateSettings({ nThreads: v })}
      />
    </View>
  );
};

export const BatchSizeSlider: React.FC = () => {
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const { settings, updateSettings } = useAppStore();
  return (
    <View style={styles.container}>
      <SliderSetting
        testID="batch-size-stepper"
        label="Batch Size"
        description="Tokens processed per batch"
        value={settings.nBatch ?? 512}
        min={32} max={512} step={32}
        onChange={(v) => updateSettings({ nBatch: v })}
      />
    </View>
  );
};
