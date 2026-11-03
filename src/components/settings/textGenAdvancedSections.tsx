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
import { Platform, View, Text, TouchableOpacity } from 'react-native';
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
import { llmService } from '../../services/llm';
import { describeOffload } from '../../services/gpuOffload';
import { createTextGenAdvancedStyles } from './textGenAdvancedStyles';

const isAndroid = Platform.OS === 'android';

// ─── Reusable pill row ─────────────────────────────────────────────────────────

interface PillOption<T extends string> {
  id: T;
  label: string;
}

/** A labelled segmented control: title + description + a row of pill buttons.
 *  The one place the pill markup lives, so every setting renders identically. */
function SegmentedRow<T extends string>(props: {
  label: string;
  description: string;
  options: PillOption<T>[];
  current: T;
  onSelect: (id: T) => void;
  testIdFor?: (id: T) => string;
  isDisabled?: (id: T) => boolean;
  children?: React.ReactNode;
}): React.ReactElement {
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const { label, description, options, current, onSelect, testIdFor, isDisabled, children } = props;
  return (
    <View style={styles.container}>
      <View style={styles.info}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.desc}>{description}</Text>
      </View>
      <View style={styles.buttons}>
        {options.map(o => {
          const active = current === o.id;
          return (
            <TouchableOpacity
              key={o.id}
              testID={testIdFor?.(o.id)}
              style={[styles.button, active && styles.buttonActive]}
              disabled={isDisabled?.(o.id)}
              onPress={() => onSelect(o.id)}
            >
              <Text style={[styles.buttonText, active && styles.buttonTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {children}
    </View>
  );
}

const BOOL_OPTIONS: PillOption<'off' | 'on'>[] = [
  { id: 'off', label: 'Off' },
  { id: 'on', label: 'On' },
];

// ─── Inference Backend ─────────────────────────────────────────────────────────

type BackendOption = { id: InferenceBackend; label: string; desc: string };

const IOS_BACKENDS: BackendOption[] = [
  { id: INFERENCE_BACKENDS.CPU, label: 'CPU', desc: 'Always available. Stable, predictable performance.' },
  { id: INFERENCE_BACKENDS.METAL, label: 'Metal', desc: 'Offload layers to GPU via Metal. Faster for larger models. Requires model reload.' },
];

// Automatic is the recommended choice; the others force one engine (each falls back to CPU
// with a visible reason if it cannot load the model).
const ANDROID_BASE_BACKENDS: BackendOption[] = [
  { id: INFERENCE_BACKENDS.AUTO, label: 'Automatic', desc: 'Recommended. Atlas tries the NPU, then the OpenCL GPU, then the Vulkan GPU, then the CPU for each model. Vulkan is skipped on the Mali-G57, where the CPU is faster.' },
  { id: INFERENCE_BACKENDS.HTP, label: 'NPU', desc: 'Force the Snapdragon NPU. Needs a Q4_0 or Q8_0 text model; other formats are refused.' },
  { id: INFERENCE_BACKENDS.OPENCL, label: 'OpenCL', desc: 'Force the OpenCL GPU (Adreno). Keeps tools and pictures.' },
  { id: INFERENCE_BACKENDS.VULKAN, label: 'Vulkan', desc: 'Force the Vulkan GPU (also Mali and other GPUs). Text chat only: no tools and no picture input, because llama.kt has neither. Use OpenCL (Adreno) or Automatic for those.' },
  { id: INFERENCE_BACKENDS.CPU, label: 'CPU only', desc: 'Run without hardware acceleration. Always works, can be considerably slower.' },
];

/** What the currently loaded model actually got, never the requested number. */
function describeLoadedOffload(): string {
  if (!llmService.isModelLoaded()) return 'Load a model to see how many layers run on the accelerator.';
  const info = llmService.getGpuInfo();
  if (!info.gpu) return 'Loaded model is running on the CPU (no accelerator layers).';
  return `Loaded model: ${describeOffload(info.gpuLayers, info.totalLayers ?? -1)} on ${info.gpuBackend || 'the accelerator'}.`;
}

export const BackendSelector: React.FC = () => {
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const { settings, updateSettings } = useAppStore();
  const { gpuLayersEffective } = useTextGenerationAdvanced();
  const backends: BackendOption[] = Platform.OS === 'ios' ? IOS_BACKENDS : ANDROID_BASE_BACKENDS;

  const defaultBackend = Platform.OS === 'ios' ? INFERENCE_BACKENDS.METAL : INFERENCE_BACKENDS.CPU;
  const savedBackend = settings.inferenceBackend ?? defaultBackend;
  const current = savedBackend;
  const showLayers = current !== INFERENCE_BACKENDS.CPU;
  const layersLabel = current === INFERENCE_BACKENDS.METAL ? 'GPU Layers (Metal)' : 'Accelerator Layer Limit';

  return (
    <SegmentedRow<InferenceBackend>
      label="Inference Backend"
      description={backends.find(b => b.id === current)?.desc ?? ''}
      options={backends}
      current={current}
      onSelect={(id) => updateSettings({
        inferenceBackend: id,
        backendUserChosen: true,
        ...(id !== INFERENCE_BACKENDS.CPU && (settings.gpuLayers ?? 0) <= 0
          ? { gpuLayers: gpuLayersEffective }
          : {}),
      } as any)}
      testIdFor={(id) => `backend-${id}-button`}
    >
      {showLayers && (
        <View style={styles.layersInline}>
          <SliderSetting
            testID="gpu-layers-stepper"
            label={layersLabel}
            description="Layers offloaded to the GPU/NPU. Higher is faster but uses more memory. Maximum safe offloads every layer this device's RAM allows. Requires model reload."
            value={gpuLayersEffective}
            min={1} max={GPU_LAYERS_MAX} step={1}
            onChange={(value) => updateSettings({ gpuLayers: value })}
          />
          <View style={styles.buttons}>
            <TouchableOpacity
              testID="gpu-layers-max-button"
              style={[styles.button, gpuLayersEffective >= GPU_LAYERS_MAX && styles.buttonActive]}
              onPress={() => updateSettings({ gpuLayers: GPU_LAYERS_MAX })}
            >
              <Text style={[styles.buttonText, gpuLayersEffective >= GPU_LAYERS_MAX && styles.buttonTextActive]}>
                Maximum safe
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.desc} testID="gpu-layers-actual">{describeLoadedOffload()}</Text>
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
const LITERT_NPU = { id: 'npu' as LiteRTBackend, label: 'NPU', desc: 'Snapdragon NPU: fastest and most power-efficient for models built for it (falls back to GPU, then CPU, if the model or phone does not support it).' };

export const LiteRTBackendSelector: React.FC = () => {
  const { settings, updateSettings } = useAppStore();
  const current = settings.liteRTBackend ?? 'gpu';
  const [hasNPU, setHasNPU] = useState(false);
  useEffect(() => { if (isAndroid) hardwareService.getSoCInfo().then(i => setHasNPU(i.hasNPU)).catch(() => undefined); }, []);
  const options = hasNPU ? [...LITERT_BACKENDS, LITERT_NPU] : LITERT_BACKENDS;
  return (
    <SegmentedRow<LiteRTBackend>
      label="Acceleration"
      description={options.find(b => b.id === current)?.desc ?? ''}
      options={options}
      current={current}
      onSelect={(id) => updateSettings({ liteRTBackend: id })}
      testIdFor={(id) => `litert-backend-${id}-button`}
    />
  );
};

// ─── Flash Attention ──────────────────────────────────────────────────────────

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

// ─── Show Generation Details ──────────────────────────────────────────────────

export const ShowGenerationDetailsToggle: React.FC = () => {
  const { settings, updateSettings } = useAppStore();
  const on = !!settings.showGenerationDetails;
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

// ─── Warm-up after load ───────────────────────────────────────────────────────

export const WarmUpToggle: React.FC = () => {
  const { settings, updateSettings } = useAppStore();
  return (
    <SegmentedRow<'off' | 'on'>
      label="Warm up after loading"
      description="After a model loads, run one tiny silent reply so a GPU does its one-time setup now instead of during your first question. Only used when the GPU is on. If you send a message while it runs (it can take a while the first time), wait a moment and send again."
      options={BOOL_OPTIONS}
      current={settings.warmUpAfterLoad ? 'on' : 'off'}
      onSelect={(id) => updateSettings({ warmUpAfterLoad: id === 'on' })}
      testIdFor={(id) => `warm-up-${id}-button`}
    />
  );
};

// ─── Trim tools ───────────────────────────────────────────────────────────────

export const TrimToolsToggle: React.FC = () => {
  const { settings, updateSettings } = useAppStore();
  return (
    <SegmentedRow<'off' | 'on'>
      label="Send only the tools a message needs"
      description="The model reads every tool's description before it answers, which slows the first reply. With this on, only the tools your message could use (and ones already used in the chat) are sent. Turn it off to send every tool you have switched on, every time."
      options={BOOL_OPTIONS}
      current={settings.trimTools === false ? 'off' : 'on'}
      onSelect={(id) => updateSettings({ trimTools: id === 'on' })}
      testIdFor={(id) => `trim-tools-${id}-button`}
    />
  );
};

// ─── MTP (multi-token prediction) ─────────────────────────────────────────────

export const MtpToggle: React.FC = () => {
  const { settings, updateSettings } = useAppStore();
  return (
    <SegmentedRow<'off' | 'on'>
      label="Use MTP files"
      description="A model with an MTP file attached (My models, Add MTP file) drafts a few words ahead with it and the main model checks them, so replies can come faster. If the engine cannot start with the file, the model loads without it. Requires model reload."
      options={BOOL_OPTIONS}
      current={settings.useMtp === false ? 'off' : 'on'}
      onSelect={(id) => updateSettings({ useMtp: id === 'on' })}
      testIdFor={(id) => `use-mtp-${id}-button`}
    />
  );
};

// ─── CPU Threads & Batch Size ────────────────────────────────────────────────

export const CpuThreadsSlider: React.FC = () => {
  const styles = useThemedStyles(createTextGenAdvancedStyles);
  const { settings, updateSettings } = useAppStore();
  const { cpuThreadsSliderValue, cpuThreadsDisplayValue, cpuCores } = useTextGenerationAdvanced();
  const auto = settings?.nThreads === 0;
  return (
    <View style={styles.container}>
      <SliderSetting
        testID="cpu-threads-stepper"
        label="CPU Threads"
        description={`Parallel threads for inference: ${cpuThreadsDisplayValue}. More than the ${cpuCores} cores this device has only slows it down.`}
        value={cpuThreadsSliderValue}
        min={1} max={Math.max(1, cpuCores)} step={1}
        onChange={(v) => updateSettings({ nThreads: v })}
      />
      <View style={styles.buttons}>
        <TouchableOpacity
          testID="cpu-threads-auto-button"
          style={[styles.button, auto && styles.buttonActive]}
          onPress={() => updateSettings({ nThreads: 0 })}
        >
          <Text style={[styles.buttonText, auto && styles.buttonTextActive]}>Auto</Text>
        </TouchableOpacity>
      </View>
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
