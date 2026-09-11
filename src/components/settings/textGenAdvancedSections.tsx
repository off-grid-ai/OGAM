/**
 * Advanced text-generation setting sections — the SINGLE shared implementation
 * used by BOTH the Model Settings screen and the in-chat Generation Settings
 * modal. Previously each surface hand-rolled these (two copies of the backend
 * selector, KV-cache toggle, etc.) which drifted in copy, labels, and spacing.
 *
 * Presentation: the pill-button design (segmented control). Data + behavior come
 * from the Shared models projection and the single useTextGenerationAdvanced hook.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  type TextGenerationAdvancedSettingsSaveOutcome,
} from '../../hooks/useTextGenerationAdvanced';
import { hardwareService } from '../../services/hardware';
import {
  modelsFailureMessage,
  REASONING_BUDGET_AUTO,
  REASONING_BUDGET_OPTIONS,
  reasoningBudgetLabel,
  type SaveModelSettingsCommand,
} from '@offgrid/application';
import { HTP_ENABLED as HTP_UI_ENABLED } from '../../config/featureFlags';
import { applicationFacade } from '../../services/applicationFacade';
import { useModelsProjection } from '../../hooks/useApplicationProjection';
import { createTextGenAdvancedStyles } from './textGenAdvancedStyles';
import { SegmentedRow, BOOL_OPTIONS, type PillOption } from './segmentedRow';

const isAndroid = Platform.OS === 'android';

type ModelSettingsPatch = SaveModelSettingsCommand['patch'];
type ModelSettingsSaveOperation = () =>
  | Promise<TextGenerationAdvancedSettingsSaveOutcome>
  | undefined;

function useModelSettingsSave(): {
  save: (patch: ModelSettingsPatch) => Promise<void>;
  runSave: (operation: ModelSettingsSaveOperation) => Promise<void>;
  saveMessage: string | null;
} {
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const latestOperation = useRef(0);

  const runSave = useCallback(async (
    saveOperation: ModelSettingsSaveOperation,
  ): Promise<void> => {
    const operation = ++latestOperation.current;
    setSaveMessage(null);
    try {
      const pendingOutcome = saveOperation();
      if (!pendingOutcome) return;
      const outcome = await pendingOutcome;
      if (operation !== latestOperation.current) return;
      if (!outcome.ok) {
        setSaveMessage(modelsFailureMessage(outcome.failure));
        return;
      }
      if (outcome.value.syncFailure) {
        setSaveMessage(
          `Saved on this device. ${modelsFailureMessage(outcome.value.syncFailure)}`,
        );
      }
    } catch (error: unknown) {
      if (operation === latestOperation.current) {
        setSaveMessage(error instanceof Error ? error.message : String(error));
      }
    }
  }, []);

  const save = useCallback((patch: ModelSettingsPatch): Promise<void> => (
    runSave(() => applicationFacade().models.settings.save({
      origin: 'local',
      patch,
    }))
  ), [runSave]);

  return { save, runSave, saveMessage };
}

const SettingsSaveMessage: React.FC<{ message: string | null }> = ({ message }) => {
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  return message ? (
    <Text style={styles.warning} accessibilityLiveRegion="polite">
      {message}
    </Text>
  ) : null;
};

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
  // One field per row. A whole-store read meant dragging the GPU-layers slider re-rendered every
  // other advanced row, and any unrelated app write re-rendered all of them.
  const inferenceBackend = useModelsProjection().settings.inferenceBackend;
  const { save, saveMessage } = useModelSettingsSave();
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
  const current = inferenceBackend ?? defaultBackend;
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
      onSelect={(id) => save({ inferenceBackend: id })}
      testIdFor={(id) => `backend-${id}-button`}
    >
      {showLayers ? (
        <View style={styles.layersInline}>
          <SliderSetting
            testID="gpu-layers-stepper"
            label={layersLabel}
            description="Layers offloaded to GPU. Higher = faster but may crash on low-VRAM devices. Requires model reload."
            value={gpuLayersEffective}
            min={1} max={GPU_LAYERS_MAX} step={1}
            onChange={(value) => save({ gpuLayers: value })}
          />
        </View>
      ) : null}
      <SettingsSaveMessage message={saveMessage} />
    </SegmentedRow>
  );
};

// ─── LiteRT Acceleration ─────────────────────────────────────────────────────

const LITERT_BACKENDS: { id: LiteRTBackend; label: string; desc: string }[] = [
  { id: 'gpu', label: 'GPU', desc: 'Run on GPU via OpenCL. Best performance on most devices.' },
  { id: 'cpu', label: 'CPU', desc: 'Always available. Use for battery savings or thermal relief.' },
];

export const LiteRTBackendSelector: React.FC = () => {
  const liteRTBackend = useModelsProjection().settings.liteRTBackend;
  const { save, saveMessage } = useModelSettingsSave();
  const current = liteRTBackend ?? 'gpu';
  return (
    <SegmentedRow<LiteRTBackend>
      label="Acceleration"
      description={LITERT_BACKENDS.find(b => b.id === current)?.desc ?? ''}
      options={LITERT_BACKENDS}
      current={current}
      onSelect={(id) => save({ liteRTBackend: id })}
      testIdFor={(id) => `litert-backend-${id}-button`}
    >
      <SettingsSaveMessage message={saveMessage} />
    </SegmentedRow>
  );
};

// ─── Flash Attention ──────────────────────────────────────────────────────────

/** Lives in its own module for the file-size budget; re-exported so every surface keeps ONE
 *  import path for the advanced text-generation controls. */
export { SpeculativeDecodingToggle } from './SpeculativeDecodingToggle';

export const FlashAttentionToggle: React.FC = () => {
  const { save, runSave, saveMessage } = useModelSettingsSave();
  const { isFlashAttnOn, handleFlashAttnToggle } = useTextGenerationAdvanced();
  return (
    <SegmentedRow<'off' | 'on'>
      label="Flash Attention"
      description="Faster inference and lower memory. Required for quantized KV cache (q8_0/q4_0). Requires model reload."
      options={BOOL_OPTIONS}
      current={isFlashAttnOn ? 'on' : 'off'}
      onSelect={(id) => (
        id === 'on'
          ? save({ flashAttn: true })
          : runSave(() => handleFlashAttnToggle(false))
      )}
      testIdFor={(id) => `flash-attn-${id}-button`}
    >
      <SettingsSaveMessage message={saveMessage} />
    </SegmentedRow>
  );
};

// ─── KV Cache Type ───────────────────────────────────────────────────────────

export const KvCacheTypeToggle: React.FC = () => {
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const { runSave, saveMessage } = useModelSettingsSave();
  const { isFlashAttnOn, cacheDisabled, displayCacheType, handleCacheTypeChange } = useTextGenerationAdvanced();
  return (
    <SegmentedRow<CacheType>
      label="KV Cache Type"
      description={CACHE_TYPE_DESCRIPTIONS[displayCacheType]}
      options={CACHE_TYPE_OPTIONS.map((ct: CacheType) => ({ id: ct, label: ct }))}
      current={displayCacheType}
      onSelect={(cacheType) => runSave(() => handleCacheTypeChange(cacheType))}
      testIdFor={(ct) => `cache-type-${ct}-button`}
      isDisabled={(ct) => cacheDisabled && ct !== 'f16'}
    >
      {!isFlashAttnOn && (
        <Text style={styles.warning}>
          Quantized cache (q8_0/q4_0) will auto-enable flash attention.
        </Text>
      )}
      <SettingsSaveMessage message={saveMessage} />
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
  const settings = useModelsProjection().settings;
  const { modelLoadingMode, aggressiveModelLoading } = settings;
  const { save, saveMessage } = useModelSettingsSave();
  // Single source of truth: the 3-mode setting, falling back to the legacy boolean.
  const current: ModelLoadingMode =
    modelLoadingMode ?? (aggressiveModelLoading ? 'aggressive' : 'balanced');
  return (
    <SegmentedRow<ModelLoadingMode>
      label="Model Loading"
      description="Lean keeps ONE model in memory at a time. Balanced keeps models loaded together when they fit and swaps when they do not. Aggressive commits a larger share of RAM so bigger models load. You can always Load Anyway if a model is refused."
      options={MODE_OPTIONS}
      current={current}
      onSelect={(id) => save({ modelLoadingMode: id })}
      testIdFor={(id) => `model-loading-mode-${id}-button`}
    >
      <SettingsSaveMessage message={saveMessage} />
    </SegmentedRow>
  );
};

// ─── Thinking Budget ─────────────────────────────────────────────────────────

// The shared model contract owns the allowed values. The slider uses their
// ordered index because Auto is not a numeric token cap.
const THINKING_BUDGET_VALUES = [
  REASONING_BUDGET_AUTO,
  ...REASONING_BUDGET_OPTIONS,
] as const;

function thinkingBudgetSliderLabel(index: number): string {
  const value = THINKING_BUDGET_VALUES[Math.round(index)] ?? REASONING_BUDGET_AUTO;
  return value === REASONING_BUDGET_AUTO
    ? 'Auto'
    : reasoningBudgetLabel(value).replace(' tokens', '');
}

/** llama.rn path only: the cap rides the completion request as thinking_budget_tokens
 *  (shared rule: @offgrid/models thinkingBudgetPayload). LiteRT has no thinking channel. */
export const ThinkingBudgetSelector: React.FC = () => {
  const reasoningBudget = useModelsProjection().settings.reasoningBudget;
  const { save, saveMessage } = useModelSettingsSave();
  const current = reasoningBudget ?? REASONING_BUDGET_AUTO;
  const selectedIndex = Math.max(
    0,
    THINKING_BUDGET_VALUES.findIndex(value => value === current),
  );
  return (
    <>
      <SliderSetting
        testID="thinking-budget"
        label="Thinking Budget"
        description="Auto lets the model think for as long as it needs. A cap ends the thinking at that many tokens so the answer arrives sooner. Applies when Thinking is on."
        value={selectedIndex}
        min={0}
        max={THINKING_BUDGET_VALUES.length - 1}
        step={1}
        editableValue={false}
        formatValue={thinkingBudgetSliderLabel}
        onChange={(index) => {
          const value = THINKING_BUDGET_VALUES[Math.round(index)] ?? REASONING_BUDGET_AUTO;
          save({ reasoningBudget: value });
        }}
      />
      <SettingsSaveMessage message={saveMessage} />
    </>
  );
};

// ─── Show Generation Details ──────────────────────────────────────────────────

export const ShowGenerationDetailsToggle: React.FC = () => {
  const showGenerationDetails = useAppStore(
    s => s.settings.showGenerationDetails,
  );
  const updateSettings = useAppStore(s => s.updateSettings);
  const on = !!showGenerationDetails;
  return (
    <SegmentedRow<'off' | 'on'>
      label="Show Generation Details"
      description="Display GPU, model, tok/s, and image settings below each message"
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
  const { save, saveMessage } = useModelSettingsSave();
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
        onChange={(v) => save({ nThreads: v })}
      />
      <SettingsSaveMessage message={saveMessage} />
    </View>
  );
};

export const BatchSizeSlider: React.FC = () => {
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const nBatch = useModelsProjection().settings.nBatch;
  const { save, saveMessage } = useModelSettingsSave();
  return (
    <View style={styles.container}>
      <SliderSetting
        testID="batch-size-stepper"
        label="Batch Size"
        description="Tokens processed per batch"
        value={nBatch ?? 512}
        min={32} max={512} step={32}
        onChange={(v) => save({ nBatch: v })}
      />
      <SettingsSaveMessage message={saveMessage} />
    </View>
  );
};
