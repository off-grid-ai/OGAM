import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { SliderSetting } from '../SliderSetting';
import { AdvancedToggle } from '../AdvancedToggle';
import { useThemedStyles } from '../../theme';
import { useAppStore, selectIsLiteRT } from '../../stores';
import { hardwareService } from '../../services';
import { createStyles } from './styles';
import {
  CpuThreadsSlider,
  BatchSizeSlider,
  BackendSelector,
  LiteRTBackendSelector,
  FlashAttentionToggle,
  KvCacheTypeToggle,
} from './TextGenerationAdvanced';

interface SettingConfig {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  description?: string;
  warning?: (value: number) => string | null;
  warningColor?: string;
}

const formatContext = (v: number) => v >= 1024 ? `${(v / 1024).toFixed(0)}K` : v.toString();

const DEFAULT_SETTINGS: Record<string, number> = {
  temperature: 0.7,
  maxTokens: 1024,
  topP: 0.9,
  repeatPenalty: 1.1,
  contextLength: 4096,
  liteRTTemperature: 0.7,
  liteRTTopP: 0.9,
  liteRTMaxTokens: 4096,
};

// ─── Config builders ──────────────────────────────────────────────────────────

function buildLlamaConfig(modelMaxContext: number | null = null): SettingConfig[] {
  const llmMax = modelMaxContext ?? 32768;
  return [
    {
      key: 'temperature',
      label: 'Temperature',
      min: 0, max: 2, step: 0.05,
      format: (v) => v.toFixed(2),
      description: 'Higher = more creative, Lower = more focused',
    },
    {
      key: 'maxTokens',
      label: 'Max Tokens',
      min: 64, max: 8192, step: 64,
      format: (v) => v >= 1024 ? `${(v / 1024).toFixed(1)}K` : v.toString(),
      description: 'Maximum length of generated response',
    },
    {
      key: 'topP',
      label: 'Top P',
      min: 0.1, max: 1, step: 0.05,
      format: (v) => v.toFixed(2),
      description: 'Nucleus sampling threshold',
    },
    {
      key: 'repeatPenalty',
      label: 'Repeat Penalty',
      min: 1, max: 2, step: 0.05,
      format: (v) => v.toFixed(2),
      description: 'Penalize repeated tokens',
    },
    {
      key: 'contextLength',
      label: 'Context Length',
      min: 512, max: llmMax, step: 1024,
      format: formatContext,
      description: 'KV cache size — larger uses more RAM (requires reload)',
      warning: (v) => v > 8192 ? 'High context uses significant RAM and may crash on some devices' : null,
    },
  ];
}

function buildLiteRTConfig(modelMaxContext: number | null = null): SettingConfig[] {
  const isLargeRam = hardwareService.getTotalMemoryGB() > 8;
  const contextMax = modelMaxContext ?? (isLargeRam ? 32768 : 12288);
  const contextWarn = isLargeRam ? 16384 : 8192;
  return [
    {
      key: 'liteRTTemperature',
      label: 'Temperature',
      min: 0, max: 2, step: 0.05,
      format: (v) => v.toFixed(2),
      description: 'Higher = more creative, Lower = more focused',
    },
    {
      key: 'liteRTTopP',
      label: 'Top P',
      min: 0.1, max: 1, step: 0.05,
      format: (v) => v.toFixed(2),
      description: 'Nucleus sampling threshold',
    },
    {
      key: 'liteRTMaxTokens',
      label: 'Max Tokens',
      min: 512, max: contextMax, step: 1024,
      format: formatContext,
      description: 'Total token budget — input, history, and output combined (requires reload)',
      warning: (v) => v > contextWarn ? 'High context uses significant RAM — may slow or crash on some devices' : null,
      warningColor: '#F59E0B',
    },
  ];
}

// ─── Shared slider component ──────────────────────────────────────────────────

const SettingSlider: React.FC<{ config: SettingConfig }> = ({ config }) => {
  const { settings, updateSettings } = useAppStore();
  const rawValue = (settings as Record<string, unknown>)[config.key];
  const value = (rawValue ?? DEFAULT_SETTINGS[config.key]) as number;

  return (
    <SliderSetting
      testID={`setting-${config.key}`}
      label={config.label}
      value={value}
      min={config.min}
      max={config.max}
      step={config.step}
      formatValue={config.format}
      description={config.description}
      warning={config.warning?.(value) ?? null}
      warningColor={config.warningColor}
      onChange={(v) => updateSettings({ [config.key]: v })}
    />
  );
};

// ─── Show Generation Details ──────────────────────────────────────────────────

const ShowGenerationDetailsToggle: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const isOn = settings.showGenerationDetails;

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.modeToggleInfo}>
        <Text style={styles.modeToggleLabel}>Show Generation Details</Text>
        <Text style={styles.modeToggleDesc}>
          Display GPU, model, tok/s, and image settings below each message
        </Text>
      </View>
      <View style={styles.modeToggleButtons}>
        <TouchableOpacity
          style={[styles.modeButton, !isOn && styles.modeButtonActive]}
          onPress={() => updateSettings({ showGenerationDetails: false })}
        >
          <Text style={[styles.modeButtonText, !isOn && styles.modeButtonTextActive]}>Off</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, isOn && styles.modeButtonActive]}
          onPress={() => updateSettings({ showGenerationDetails: true })}
        >
          <Text style={[styles.modeButtonText, isOn && styles.modeButtonTextActive]}>On</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ─── LiteRT Section ───────────────────────────────────────────────────────────

const LiteRTTextGenerationSection: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const modelMaxContext = useAppStore((s) => s.modelMaxContext);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const config = buildLiteRTConfig(modelMaxContext);
  const basicKeys = new Set(['liteRTTemperature', 'liteRTMaxTokens']);
  const advancedKeys = new Set(['liteRTTopP']);

  const basicSettings = config.filter(c => basicKeys.has(c.key));
  const advancedSettings = config.filter(c => advancedKeys.has(c.key));

  return (
    <View style={styles.sectionCard}>
      {basicSettings.map((c) => (
        <SettingSlider key={c.key} config={c} />
      ))}
      <ShowGenerationDetailsToggle />

      <AdvancedToggle isExpanded={showAdvanced} onPress={() => setShowAdvanced(!showAdvanced)} testID="modal-text-advanced-toggle" />

      {showAdvanced && (
        <>
          {advancedSettings.map((c) => (
            <SettingSlider key={c.key} config={c} />
          ))}
          <LiteRTBackendSelector />
        </>
      )}
    </View>
  );
};

// ─── Llama Section ────────────────────────────────────────────────────────────

const LlamaTextGenerationSection: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const modelMaxContext = useAppStore((s) => s.modelMaxContext);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const config = buildLlamaConfig(modelMaxContext);
  const basicKeys = new Set(['temperature', 'maxTokens', 'contextLength']);
  const advancedKeys = new Set(['topP', 'repeatPenalty']);

  const basicSettings = config.filter(c => basicKeys.has(c.key));
  const advancedSettings = config.filter(c => advancedKeys.has(c.key));

  return (
    <View style={styles.sectionCard}>
      {basicSettings.map((c) => (
        <SettingSlider key={c.key} config={c} />
      ))}
      <ShowGenerationDetailsToggle />

      <AdvancedToggle isExpanded={showAdvanced} onPress={() => setShowAdvanced(!showAdvanced)} testID="modal-text-advanced-toggle" />

      {showAdvanced && (
        <>
          {advancedSettings.map((c) => (
            <SettingSlider key={c.key} config={c} />
          ))}
          <CpuThreadsSlider />
          <BatchSizeSlider />
          <BackendSelector />
          <FlashAttentionToggle />
          <KvCacheTypeToggle />
        </>
      )}
    </View>
  );
};

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export const TextGenerationSection: React.FC = () => {
  const isLiteRT = useAppStore(selectIsLiteRT);
  return isLiteRT ? <LiteRTTextGenerationSection /> : <LlamaTextGenerationSection />;
};
