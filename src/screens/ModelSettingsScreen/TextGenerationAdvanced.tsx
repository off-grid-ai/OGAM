import React, { useEffect, useState } from 'react';
import { View, Text, Switch, Platform } from 'react-native';
import { Button } from '../../components/Button';
import { SliderSetting } from '../../components/SliderSetting';
import { useTheme, useThemedStyles } from '../../theme';
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

/** Feature flag: Set to true to enable HTP/Hexagon NPU in UI. Currently disabled. */
const HTP_UI_ENABLED = false;

// ─── Inference Backend ────────────────────────────────────────────────────────

type BackendOption = { id: InferenceBackend; label: string };

const IOS_BACKENDS: BackendOption[] = [
  { id: INFERENCE_BACKENDS.CPU, label: 'CPU' },
  { id: INFERENCE_BACKENDS.METAL, label: 'Metal' },
];

const ANDROID_BASE_BACKENDS: BackendOption[] = [
  { id: INFERENCE_BACKENDS.CPU, label: 'CPU' },
  { id: INFERENCE_BACKENDS.OPENCL, label: 'OpenCL' },
];

const HTP_BACKEND: BackendOption = { id: INFERENCE_BACKENDS.HTP, label: 'HTP' };

const BackendSelectorSection: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const { gpuLayersEffective } = useTextGenerationAdvanced();
  const [hasNPU, setHasNPU] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'android') {
      hardwareService.getSoCInfo().then(info => setHasNPU(info.hasNPU));
    }
  }, []);

  const backends: BackendOption[] = Platform.OS === 'ios'
    ? IOS_BACKENDS
    : hasNPU && HTP_UI_ENABLED ? [...ANDROID_BASE_BACKENDS, HTP_BACKEND] : ANDROID_BASE_BACKENDS;

  const defaultBackend = Platform.OS === 'ios' ? INFERENCE_BACKENDS.METAL : INFERENCE_BACKENDS.CPU;
  const current = settings.inferenceBackend ?? defaultBackend;
  const showLayers = current !== INFERENCE_BACKENDS.CPU;

  return (
    <>
      <View style={styles.toggleRow}>
        <View style={styles.toggleInfo}>
          <Text style={styles.toggleLabel}>Inference Backend</Text>
          <Text style={styles.toggleDesc}>
            {current === INFERENCE_BACKENDS.CPU && 'Running on CPU threads only.'}
            {current === INFERENCE_BACKENDS.OPENCL && 'Offloading layers to GPU via OpenCL.'}
            {current === INFERENCE_BACKENDS.HTP && 'Offloading layers to Hexagon NPU.'}
            {current === INFERENCE_BACKENDS.METAL && 'Offloading layers to GPU via Metal.'}
          </Text>
        </View>
      </View>
      <View style={styles.strategyButtons}>
        {backends.map(b => (
          <Button
            key={b.id}
            title={b.label}
            variant="secondary"
            size="small"
            testID={`backend-${b.id}-button`}
            active={current === b.id}
            onPress={() => updateSettings({ inferenceBackend: b.id })}
            style={styles.flex1}
          />
        ))}
      </View>

      {showLayers && (
        <SliderSetting
          testID="gpu-layers-stepper"
          label={current === INFERENCE_BACKENDS.HTP ? 'NPU Layers' : 'GPU Layers'}
          description="Layers offloaded to GPU. Higher = faster but may crash on low-VRAM devices."
          value={gpuLayersEffective}
          min={1} max={GPU_LAYERS_MAX} step={1}
          onChange={(value) => updateSettings({ gpuLayers: value })}
        />
      )}
    </>
  );
};

// ─── LiteRT Acceleration ─────────────────────────────────────────────────────

type LiteRTBackendOption = { id: LiteRTBackend; label: string };

const LITERT_BACKENDS: LiteRTBackendOption[] = [
  { id: 'gpu', label: 'GPU' },
  { id: 'cpu', label: 'CPU' },
];

const LiteRTBackendSelectorSection: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const current = settings.liteRTBackend ?? 'gpu';

  const descriptions: Partial<Record<LiteRTBackend, string>> = {
    gpu: 'Run on GPU via OpenCL. Best performance on most devices.',
    cpu: 'Always available. Use for battery savings or thermal relief.',
  };

  return (
    <>
      <View style={styles.toggleRow}>
        <View style={styles.toggleInfo}>
          <Text style={styles.toggleLabel}>Acceleration</Text>
          <Text style={styles.toggleDesc}>{descriptions[current]}</Text>
        </View>
      </View>
      <View style={styles.strategyButtons}>
        {LITERT_BACKENDS.map(b => (
          <Button
            key={b.id}
            title={b.label}
            variant="secondary"
            size="small"
            testID={`litert-backend-${b.id}-button`}
            active={current === b.id}
            onPress={() => updateSettings({ liteRTBackend: b.id })}
            style={styles.flex1}
          />
        ))}
      </View>
    </>
  );
};

// ─── Flash Attention ──────────────────────────────────────────────────────────

const FlashAttentionSection: React.FC<{ trackColor: { false: string; true: string } }> = ({ trackColor }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { isFlashAttnOn, handleFlashAttnToggle } = useTextGenerationAdvanced();

  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleInfo}>
        <Text style={styles.toggleLabel}>Flash Attention</Text>
        <Text style={styles.toggleDesc}>
          Faster inference and lower memory. Required for quantized KV cache (q8_0/q4_0). Requires model reload.
        </Text>
      </View>
      <Switch
        testID="flash-attn-switch"
        value={isFlashAttnOn}
        onValueChange={handleFlashAttnToggle}
        trackColor={trackColor}
        thumbColor={isFlashAttnOn ? colors.primary : colors.textMuted}
      />
    </View>
  );
};

// ─── KV Cache Section ─────────────────────────────────────────────────────────

const KvCacheSection: React.FC<{ cacheDisabled: boolean }> = ({ cacheDisabled }) => {
  const styles = useThemedStyles(createStyles);
  const { displayCacheType, isFlashAttnOn, handleCacheTypeChange } = useTextGenerationAdvanced();

  return (
    <>
      <View style={styles.toggleRow}>
        <View style={styles.toggleInfo}>
          <Text style={styles.toggleLabel}>KV Cache Type</Text>
          <Text style={styles.toggleDesc}>
            {CACHE_TYPE_DESCRIPTIONS[displayCacheType]}
          </Text>
        </View>
      </View>
      <View style={styles.strategyButtons}>
        {CACHE_TYPE_OPTIONS.map((ct: CacheType) => (
          <Button
            key={ct}
            title={ct}
            variant="secondary"
            size="small"
            active={displayCacheType === ct}
            disabled={cacheDisabled && ct !== 'f16'}
            onPress={() => handleCacheTypeChange(ct)}
            style={styles.flex1}
          />
        ))}
      </View>
      {!isFlashAttnOn && (
        <Text style={styles.warningText}>
          Quantized cache (q8_0/q4_0) will auto-enable flash attention.
        </Text>
      )}
    </>
  );
};

// ─── Llama Advanced ──────────────────────────────────────────────────────────

export const TextGenerationAdvanced: React.FC = () => {
  const { colors } = useTheme();
  const { settings, updateSettings } = useAppStore();
  const { cacheDisabled, cpuThreadsSliderValue } = useTextGenerationAdvanced();

  const trackColor = { false: colors.surfaceLight, true: `${colors.primary}80` };

  return (
    <>
      <SliderSetting
        testID="llama-top-p"
        label="Top P"
        description="Nucleus sampling threshold"
        value={settings?.topP || 0.9}
        min={0.1} max={1.0} step={0.05} decimals={2}
        onChange={(value) => updateSettings({ topP: value })}
      />

      <SliderSetting
        testID="repeat-penalty"
        label="Repeat Penalty"
        description="Penalize repeated tokens"
        value={settings?.repeatPenalty || 1.1}
        min={1.0} max={2.0} step={0.05} decimals={2}
        onChange={(value) => updateSettings({ repeatPenalty: value })}
      />

      <SliderSetting
        testID="cpu-threads"
        label="CPU Threads"
        description="Parallel threads for inference"
        value={cpuThreadsSliderValue}
        min={1} max={12} step={1}
        onChange={(value) => updateSettings({ nThreads: value })}
      />

      <SliderSetting
        testID="batch-size"
        label="Batch Size"
        description="Tokens processed per batch"
        value={settings?.nBatch || 256}
        min={32} max={512} step={32}
        onChange={(value) => updateSettings({ nBatch: value })}
      />

      <BackendSelectorSection />
      <FlashAttentionSection trackColor={trackColor} />
      <KvCacheSection cacheDisabled={cacheDisabled} />
    </>
  );
};

// ─── LiteRT Advanced ─────────────────────────────────────────────────────────

export const LiteRTTextGenerationAdvanced: React.FC = () => {
  const { settings, updateSettings } = useAppStore();

  return (
    <>
      <SliderSetting
        testID="litert-top-p"
        label="Top P"
        description="Nucleus sampling threshold"
        value={settings?.liteRTTopP || 0.9}
        min={0.1} max={1.0} step={0.05} decimals={2}
        onChange={(value) => updateSettings({ liteRTTopP: value })}
      />

      <LiteRTBackendSelectorSection />
    </>
  );
};
