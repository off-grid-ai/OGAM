import React from 'react';
import { View, Text, Switch, Platform } from 'react-native';
import { Button } from '../../components/Button';
import { NumericStepper } from '../../components/NumericStepper';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { CacheType } from '../../types';
import {
  useTextGenerationAdvanced,
  CACHE_TYPE_DESCRIPTIONS,
  GPU_LAYERS_MAX,
  CACHE_TYPE_OPTIONS,
} from '../../hooks/useTextGenerationAdvanced';
import { createStyles } from './styles';

// ─── GPU Section ──────────────────────────────────────────────────────────────

interface GpuSectionProps {
  isGpuEnabled: boolean;
  gpuLayersEffective: number;
  trackColor: { false: string; true: string };
  onGpuChange: (value: boolean) => void;
}

const GpuSection: React.FC<GpuSectionProps> = ({
  isGpuEnabled,
  gpuLayersEffective,
  trackColor,
  onGpuChange,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { updateSettings } = useAppStore();

  return (
    <>
      <View style={styles.toggleRow}>
        <View style={styles.toggleInfo}>
          <Text style={styles.toggleLabel}>GPU Acceleration</Text>
          <Text style={styles.toggleDesc}>
            Offload model layers to GPU. Requires model reload.
          </Text>
        </View>
        <Switch
          testID="gpu-acceleration-switch"
          value={isGpuEnabled}
          onValueChange={onGpuChange}
          trackColor={trackColor}
          thumbColor={isGpuEnabled ? colors.primary : colors.textMuted}
        />
      </View>

      {isGpuEnabled && (
        <View style={styles.sliderSection}>
          <Text style={styles.sliderLabel}>GPU Layers</Text>
          <Text style={styles.sliderDesc}>
            Layers offloaded to GPU. Higher = faster but may crash on low-VRAM devices.
          </Text>
          <NumericStepper
            testID="gpu-layers-stepper"
            value={gpuLayersEffective}
            min={1} max={GPU_LAYERS_MAX} step={1}
            onChange={(value) => updateSettings({ gpuLayers: value })}
          />
        </View>
      )}
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
      {cacheDisabled && (
        <Text style={styles.warningText}>
          GPU acceleration on Android requires f16 KV cache.
        </Text>
      )}
      {!cacheDisabled && !isFlashAttnOn && (
        <Text style={styles.warningText}>
          Quantized cache (q8_0/q4_0) will auto-enable flash attention.
        </Text>
      )}
    </>
  );
};

// ─── Model Loading Strategy ───────────────────────────────────────────────────

const ModelLoadingStrategySection: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();

  return (
    <>
      <View style={styles.toggleRow}>
        <View style={styles.toggleInfo}>
          <Text style={styles.toggleLabel}>Model Loading Strategy</Text>
          <Text style={styles.toggleDesc}>
            {settings?.modelLoadingStrategy === 'performance'
              ? 'Keep models loaded for faster responses'
              : 'Load models on demand to save memory'}
          </Text>
        </View>
      </View>
      <View style={styles.strategyButtons}>
        <Button
          title="Save Memory"
          variant="secondary"
          size="small"
          testID="strategy-memory-button"
          active={settings?.modelLoadingStrategy === 'memory'}
          onPress={() => updateSettings({ modelLoadingStrategy: 'memory' })}
          style={styles.flex1}
        />
        <Button
          title="Fast"
          variant="secondary"
          size="small"
          testID="strategy-performance-button"
          active={settings?.modelLoadingStrategy === 'performance'}
          onPress={() => updateSettings({ modelLoadingStrategy: 'performance' })}
          style={styles.flex1}
        />
      </View>
    </>
  );
};

// ─── Main Advanced Component ─────────────────────────────────────────────────

export const TextGenerationAdvanced: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const {
    gpuLayersEffective,
    isGpuEnabled,
    cacheDisabled,
    handleGpuToggle,
  } = useTextGenerationAdvanced();

  const trackColor = { false: colors.surfaceLight, true: `${colors.primary}80` };

  return (
    <>
      <View style={styles.sliderSection}>
        <Text style={styles.sliderLabel}>Top P</Text>
        <Text style={styles.sliderDesc}>Nucleus sampling threshold</Text>
        <NumericStepper
          value={settings?.topP || 0.9}
          min={0.1} max={1.0} step={0.05} decimals={2}
          onChange={(value) => updateSettings({ topP: value })}
        />
      </View>

      <View style={styles.sliderSection}>
        <Text style={styles.sliderLabel}>Repeat Penalty</Text>
        <Text style={styles.sliderDesc}>Penalize repeated tokens</Text>
        <NumericStepper
          value={settings?.repeatPenalty || 1.1}
          min={1.0} max={2.0} step={0.05} decimals={2}
          onChange={(value) => updateSettings({ repeatPenalty: value })}
        />
      </View>

      <View style={styles.sliderSection}>
        <Text style={styles.sliderLabel}>CPU Threads</Text>
        <Text style={styles.sliderDesc}>Parallel threads for inference</Text>
        <NumericStepper
          value={settings?.nThreads || 6}
          min={1} max={12} step={1}
          onChange={(value) => updateSettings({ nThreads: value })}
        />
      </View>

      <View style={styles.sliderSection}>
        <Text style={styles.sliderLabel}>Batch Size</Text>
        <Text style={styles.sliderDesc}>Tokens processed per batch</Text>
        <NumericStepper
          value={settings?.nBatch || 256}
          min={32} max={512} step={32}
          onChange={(value) => updateSettings({ nBatch: value })}
        />
      </View>

      {Platform.OS !== 'ios' && (
        <GpuSection
          isGpuEnabled={isGpuEnabled}
          gpuLayersEffective={gpuLayersEffective}
          trackColor={trackColor}
          onGpuChange={handleGpuToggle}
        />
      )}

      <FlashAttentionSection trackColor={trackColor} />
      <KvCacheSection cacheDisabled={cacheDisabled} />
      <ModelLoadingStrategySection />
    </>
  );
};
