import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { NumericStepper } from '../NumericStepper';
import { AdvancedToggle } from '../AdvancedToggle';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { createStyles } from './styles';
import {
  CpuThreadsSlider,
  BatchSizeSlider,
  GpuAccelerationToggle,
  FlashAttentionToggle,
  KvCacheTypeToggle,
  ModelLoadingStrategyToggle,
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
}

const DEFAULT_SETTINGS: Record<string, number> = {
  temperature: 0.7,
  maxTokens: 1024,
  topP: 0.9,
  repeatPenalty: 1.1,
  contextLength: 2048,
};

const FALLBACK_MAX_CONTEXT = 32768;
const HIGH_CONTEXT_THRESHOLD = 8192;

const formatContext = (v: number) => v >= 1024 ? `${(v / 1024).toFixed(0)}K` : v.toString();

const contextWarning = (v: number): string | null =>
  v > HIGH_CONTEXT_THRESHOLD ? 'High context uses significant RAM and may crash on some devices' : null;

const BASIC_KEYS = ['temperature', 'maxTokens', 'contextLength'];

const buildSettingsConfig = (modelMaxContext: number | null): SettingConfig[] => [
  {
    key: 'temperature',
    label: 'Temperature',
    min: 0,
    max: 2,
    step: 0.05,
    format: (v) => v.toFixed(2),
    description: 'Higher = more creative, Lower = more focused',
  },
  {
    key: 'maxTokens',
    label: 'Max Tokens',
    min: 64,
    max: 8192,
    step: 64,
    format: (v) => v >= 1024 ? `${(v / 1024).toFixed(1)}K` : v.toString(),
    description: 'Maximum length of generated response',
  },
  {
    key: 'topP',
    label: 'Top P',
    min: 0.1,
    max: 1.0,
    step: 0.05,
    format: (v) => v.toFixed(2),
    description: 'Nucleus sampling threshold',
  },
  {
    key: 'repeatPenalty',
    label: 'Repeat Penalty',
    min: 1.0,
    max: 2.0,
    step: 0.05,
    format: (v) => v.toFixed(2),
    description: 'Penalize repeated tokens',
  },
  {
    key: 'contextLength',
    label: 'Context Length',
    min: 512,
    max: modelMaxContext || FALLBACK_MAX_CONTEXT,
    step: 1024,
    format: formatContext,
    description: 'KV cache size — larger uses more RAM (requires reload)',
    warning: contextWarning,
  },
];

interface SettingSliderProps {
  config: SettingConfig;
}

const SettingSlider: React.FC<SettingSliderProps> = ({ config }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const rawValue = (settings as Record<string, unknown>)[config.key];
  const value = (rawValue ?? DEFAULT_SETTINGS[config.key]) as number;
  const warningText = config.warning?.(value) ?? null;
  const decimals = config.step < 1 ? 2 : 0;

  return (
    <View style={styles.settingGroup}>
      <Text style={styles.settingLabel}>{config.label}</Text>
      {config.description && (
        <Text style={styles.settingDescription}>{config.description}</Text>
      )}
      {warningText && (
        <Text style={[styles.settingDescription, { color: colors.error }]}>{warningText}</Text>
      )}
      <NumericStepper
        value={value}
        min={config.min} max={config.max} step={config.step} decimals={decimals}
        formatValue={config.format}
        onChange={(v) => updateSettings({ [config.key]: v })}
      />
    </View>
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

// ─── Main Section ─────────────────────────────────────────────────────────────

export const TextGenerationSection: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const modelMaxContext = useAppStore((s) => s.modelMaxContext);
  const settingsConfig = buildSettingsConfig(modelMaxContext);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const basicSettings = settingsConfig.filter(c => BASIC_KEYS.includes(c.key));
  const advancedSettings = settingsConfig.filter(c => !BASIC_KEYS.includes(c.key));

  return (
    <View style={styles.sectionCard}>
      {basicSettings.map((config) => (
        <SettingSlider key={config.key} config={config} />
      ))}
      <ShowGenerationDetailsToggle />

      <AdvancedToggle isExpanded={showAdvanced} onPress={() => setShowAdvanced(!showAdvanced)} testID="modal-text-advanced-toggle" />

      {showAdvanced && (
        <>
          {advancedSettings.map((config) => (
            <SettingSlider key={config.key} config={config} />
          ))}
          <CpuThreadsSlider />
          <BatchSizeSlider />
          {Platform.OS !== 'ios' && <GpuAccelerationToggle />}
          <FlashAttentionToggle />
          <KvCacheTypeToggle />
          <ModelLoadingStrategyToggle />
        </>
      )}
    </View>
  );
};
