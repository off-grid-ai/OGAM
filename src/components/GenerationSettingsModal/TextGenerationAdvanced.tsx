import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { NumericStepper } from '../NumericStepper';
import { useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { CacheType } from '../../types';
import {
  useTextGenerationAdvanced,
  CACHE_TYPE_DESCRIPTIONS,
  GPU_LAYERS_MAX,
  CACHE_TYPE_OPTIONS,
} from '../../hooks/useTextGenerationAdvanced';
import { createStyles } from './styles';

// ─── GPU Acceleration ─────────────────────────────────────────────────────────

export const GpuAccelerationToggle: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const { gpuLayersEffective, handleGpuToggle } = useTextGenerationAdvanced();

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.modeToggleInfo}>
        <Text style={styles.modeToggleLabel}>GPU Acceleration</Text>
        <Text style={styles.modeToggleDesc}>
          Offload inference to GPU when available. Faster for large models, may add overhead for small ones. Requires model reload.
        </Text>
      </View>
      <View style={styles.modeToggleButtons}>
        <TouchableOpacity
          testID="gpu-off-button"
          style={[styles.modeButton, !settings.enableGpu && styles.modeButtonActive]}
          onPress={() => handleGpuToggle(false)}
        >
          <Text style={[styles.modeButtonText, !settings.enableGpu && styles.modeButtonTextActive]}>
            Off
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="gpu-on-button"
          style={[styles.modeButton, settings.enableGpu && styles.modeButtonActive]}
          onPress={() => handleGpuToggle(true)}
        >
          <Text style={[styles.modeButtonText, settings.enableGpu && styles.modeButtonTextActive]}>
            On
          </Text>
        </TouchableOpacity>
      </View>

      {settings.enableGpu && (
        <View style={styles.gpuLayersInline}>
          <Text style={styles.settingLabel}>GPU Layers</Text>
          <Text style={styles.settingDescription}>
            Layers offloaded to GPU. Higher = faster but may crash on low-VRAM devices. Requires model reload.
          </Text>
          <NumericStepper
            testID="gpu-layers-stepper"
            value={gpuLayersEffective}
            min={1} max={GPU_LAYERS_MAX} step={1}
            onChange={(value) => updateSettings({ gpuLayers: value })}
          />
        </View>
      )}
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
      {cacheDisabled && (
        <Text style={styles.settingWarning}>
          GPU acceleration on Android requires f16 KV cache.
        </Text>
      )}
      {!cacheDisabled && !isFlashAttnOn && (
        <Text style={styles.settingWarning}>
          Quantized cache (q8_0/q4_0) will auto-enable flash attention.
        </Text>
      )}
    </View>
  );
};

// ─── Model Loading Strategy ───────────────────────────────────────────────────

export const ModelLoadingStrategyToggle: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const isPerformance = settings.modelLoadingStrategy === 'performance';
  const isMemory = settings.modelLoadingStrategy === 'memory';

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.modeToggleInfo}>
        <Text style={styles.modeToggleLabel}>Model Loading Strategy</Text>
        <Text style={styles.modeToggleDesc}>
          {isPerformance
            ? 'Keep models loaded for faster responses (uses more memory)'
            : 'Load models on demand to save memory (slower switching)'}
        </Text>
      </View>
      <View style={styles.modeToggleButtons}>
        <TouchableOpacity
          style={[styles.modeButton, isMemory && styles.modeButtonActive]}
          onPress={() => updateSettings({ modelLoadingStrategy: 'memory' })}
        >
          <Text style={[styles.modeButtonText, isMemory && styles.modeButtonTextActive]}>
            Save Memory
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, isPerformance && styles.modeButtonActive]}
          onPress={() => updateSettings({ modelLoadingStrategy: 'performance' })}
        >
          <Text style={[styles.modeButtonText, isPerformance && styles.modeButtonTextActive]}>
            Fast
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ─── CPU Threads & Batch Size ────────────────────────────────────────────────

export const CpuThreadsSlider: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();

  return (
    <View style={styles.modeToggleContainer}>
      <Text style={styles.settingLabel}>CPU Threads</Text>
      <Text style={styles.settingDescription}>Parallel threads for inference</Text>
      <NumericStepper
        value={settings.nThreads ?? 6}
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
      <Text style={styles.settingLabel}>Batch Size</Text>
      <Text style={styles.settingDescription}>Tokens processed per batch</Text>
      <NumericStepper
        value={settings.nBatch ?? 512}
        min={32} max={512} step={32}
        onChange={(v) => updateSettings({ nBatch: v })}
      />
    </View>
  );
};
