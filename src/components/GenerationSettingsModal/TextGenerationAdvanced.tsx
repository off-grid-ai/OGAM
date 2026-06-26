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
import { createStyles } from './styles';

const isAndroid = Platform.OS === 'android';

/** Feature flag: Set to true to enable HTP/Hexagon NPU in UI. Currently disabled. */
const HTP_UI_ENABLED = false;

// ─── Inference Backend ────────────────────────────────────────────────────────

type BackendOption = { id: InferenceBackend; label: string; desc: string };

const IOS_BACKENDS: BackendOption[] = [
  { id: INFERENCE_BACKENDS.CPU, label: 'CPU', desc: 'Always available. Stable, predictable performance.' },
  { id: INFERENCE_BACKENDS.METAL, label: 'Metal', desc: 'Offload layers to GPU via Metal. Faster for larger models. Requires model reload.' },
];

const ANDROID_BASE_BACKENDS: BackendOption[] = [
  { id: INFERENCE_BACKENDS.CPU, label: 'CPU', desc: 'Always available. Stable, predictable performance.' },
  { id: INFERENCE_BACKENDS.OPENCL, label: 'OpenCL', desc: 'Offload layers to GPU via OpenCL. Fast decode on Adreno/Mali GPUs. Requires model reload.' },
];

const HTP_BACKEND: BackendOption = {
  id: INFERENCE_BACKENDS.HTP, label: 'HTP', desc: 'Offload layers to Hexagon NPU on Snapdragon devices. Best for large models. Requires model reload.',
};

export const BackendSelector: React.FC = () => {
  const styles = useThemedStyles(createStyles);
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
  const layersLabel = current === INFERENCE_BACKENDS.HTP ? 'NPU Layers' : current === INFERENCE_BACKENDS.METAL ? 'GPU Layers (Metal)' : 'GPU Layers (OpenCL)';

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.modeToggleInfo}>
        <Text style={styles.modeToggleLabel}>Inference Backend</Text>
        <Text style={styles.modeToggleDesc}>
          {backends.find(b => b.id === current)?.desc ?? ''}
        </Text>
      </View>
      <View style={styles.modeToggleButtons}>
        {backends.map(b => (
          <TouchableOpacity
            key={b.id}
            testID={`backend-${b.id}-button`}
            style={[styles.modeButton, current === b.id && styles.modeButtonActive]}
            onPress={() => updateSettings({ inferenceBackend: b.id })}
          >
            <Text style={[styles.modeButtonText, current === b.id && styles.modeButtonTextActive]}>
              {b.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {showLayers && (
        <View style={styles.gpuLayersInline}>
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
    </View>
  );
};

// ─── LiteRT Acceleration ─────────────────────────────────────────────────────

type LiteRTBackendOption = { id: LiteRTBackend; label: string; desc: string };

const LITERT_BACKENDS: LiteRTBackendOption[] = [
  { id: 'gpu', label: 'GPU', desc: 'Run on GPU via OpenCL. Best performance on most devices.' },
  { id: 'cpu', label: 'CPU', desc: 'Always available. Use for battery savings or thermal relief.' },
];

export const LiteRTBackendSelector: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const current = settings.liteRTBackend ?? 'gpu';

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.modeToggleInfo}>
        <Text style={styles.modeToggleLabel}>Acceleration</Text>
        <Text style={styles.modeToggleDesc}>
          {LITERT_BACKENDS.find(b => b.id === current)?.desc ?? ''}
        </Text>
      </View>
      <View style={styles.modeToggleButtons}>
        {LITERT_BACKENDS.map(b => (
          <TouchableOpacity
            key={b.id}
            testID={`litert-backend-${b.id}-button`}
            style={[styles.modeButton, current === b.id && styles.modeButtonActive]}
            onPress={() => updateSettings({ liteRTBackend: b.id })}
          >
            <Text style={[styles.modeButtonText, current === b.id && styles.modeButtonTextActive]}>
              {b.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

// ─── Flash Attention ──────────────────────────────────────────────────────────

export const FlashAttentionToggle: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { updateSettings } = useAppStore();
  const { isFlashAttnOn, handleFlashAttnToggle } = useTextGenerationAdvanced();

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.modeToggleInfo}>
        <Text style={styles.modeToggleLabel}>Flash Attention</Text>
        <Text style={styles.modeToggleDesc}>
          Faster inference and lower memory. Required for quantized KV cache (q8_0/q4_0). Requires model reload.
        </Text>
      </View>
      <View style={styles.modeToggleButtons}>
        <TouchableOpacity
          testID="flash-attn-off-button"
          style={[styles.modeButton, !isFlashAttnOn && styles.modeButtonActive]}
          onPress={() => handleFlashAttnToggle(false)}
        >
          <Text style={[styles.modeButtonText, !isFlashAttnOn && styles.modeButtonTextActive]}>
            Off
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="flash-attn-on-button"
          style={[styles.modeButton, isFlashAttnOn && styles.modeButtonActive]}
          onPress={() => updateSettings({ flashAttn: true })}
        >
          <Text style={[styles.modeButtonText, isFlashAttnOn && styles.modeButtonTextActive]}>
            On
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ─── KV Cache Type ───────────────────────────────────────────────────────────

export const KvCacheTypeToggle: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { isFlashAttnOn, cacheDisabled, displayCacheType, handleCacheTypeChange } = useTextGenerationAdvanced();

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.modeToggleInfo}>
        <Text style={styles.modeToggleLabel}>KV Cache Type</Text>
        <Text style={styles.modeToggleDesc}>{CACHE_TYPE_DESCRIPTIONS[displayCacheType]}</Text>
      </View>
      <View style={styles.modeToggleButtons}>
        {CACHE_TYPE_OPTIONS.map((ct: CacheType) => (
          <TouchableOpacity
            key={ct}
            testID={`cache-type-${ct}-button`}
            style={[styles.modeButton, displayCacheType === ct && styles.modeButtonActive]}
            onPress={() => handleCacheTypeChange(ct)}
            disabled={cacheDisabled && ct !== 'f16'}
          >
            <Text style={[styles.modeButtonText, displayCacheType === ct && styles.modeButtonTextActive]}>
              {ct}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {!isFlashAttnOn && (
        <Text style={styles.settingWarning}>
          Quantized cache (q8_0/q4_0) will auto-enable flash attention.
        </Text>
      )}
    </View>
  );
};

// ─── CPU Threads & Batch Size ────────────────────────────────────────────────

export const CpuThreadsSlider: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { updateSettings } = useAppStore();
  const { cpuThreadsSliderValue } = useTextGenerationAdvanced();

  return (
    <View style={styles.modeToggleContainer}>
      <SliderSetting
        testID="cpu-threads-stepper"
        label="CPU Threads"
        description="Parallel threads for inference"
        value={cpuThreadsSliderValue}
        min={1} max={12} step={1}
        onChange={(v) => updateSettings({ nThreads: v })}
      />
    </View>
  );
};

export const BatchSizeSlider: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();

  return (
    <View style={styles.modeToggleContainer}>
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
