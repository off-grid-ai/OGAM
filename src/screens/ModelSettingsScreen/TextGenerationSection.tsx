import React, { useState } from 'react';
import { View, Text, Switch } from 'react-native';
import { AdvancedToggle, Card } from '../../components';
import { SliderSetting } from '../../components/SliderSetting';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore, selectIsLiteRT } from '../../stores';
import { hardwareService } from '../../services';
import { createStyles } from './styles';
import { TextGenerationAdvanced, LiteRTTextGenerationAdvanced } from './TextGenerationAdvanced';

const formatContext = (v: number) => v >= 1024 ? `${(v / 1024).toFixed(0)}K` : String(v);
const formatMaxTokens = (v: number) => v >= 1024 ? `${(v / 1024).toFixed(1)}K` : String(v);

// ─── Shared ───────────────────────────────────────────────────────────────────

const ShowGenerationDetailsToggle: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const trackColor = { false: colors.surfaceLight, true: `${colors.primary}80` };

  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleInfo}>
        <Text style={styles.toggleLabel}>Show Generation Details</Text>
        <Text style={styles.toggleDesc}>
          Display tokens/sec, timing, and memory usage on responses
        </Text>
      </View>
      <Switch
        value={settings?.showGenerationDetails ?? false}
        onValueChange={(value) => updateSettings({ showGenerationDetails: value })}
        trackColor={trackColor}
        thumbColor={settings?.showGenerationDetails ? colors.primary : colors.textMuted}
      />
    </View>
  );
};

// ─── LiteRT Settings ─────────────────────────────────────────────────────────

const LiteRTTextSettings: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const modelMaxContext = useAppStore((s) => s.modelMaxContext);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isLargeRam = hardwareService.getTotalMemoryGB() > 8;
  const contextMax = modelMaxContext ?? (isLargeRam ? 32768 : 12288);
  const contextWarnThreshold = isLargeRam ? 16384 : 8192;

  const temperature = settings?.liteRTTemperature ?? 0.7;
  const maxTokens = settings?.liteRTMaxTokens ?? 4096;

  return (
    <Card style={styles.section}>
      <Text style={styles.settingHelp}>Configure LiteRT model behavior.</Text>

      <SliderSetting
        testID="litert-temperature"
        label="Temperature"
        description="Higher = more creative, Lower = more focused"
        value={temperature}
        min={0} max={2} step={0.05} decimals={2}
        onChange={(value) => updateSettings({ liteRTTemperature: value })}
      />

      <SliderSetting
        testID="litert-max-tokens"
        label="Max Tokens"
        description="Total token budget — input, history, and output combined (requires reload)"
        warning={maxTokens > contextWarnThreshold ? 'High context uses significant RAM — may slow or crash on some devices' : null}
        value={maxTokens}
        min={512} max={contextMax} step={1024}
        formatValue={formatContext}
        onChange={(value) => updateSettings({ liteRTMaxTokens: value })}
      />

      <ShowGenerationDetailsToggle />

      <AdvancedToggle isExpanded={showAdvanced} onPress={() => setShowAdvanced(!showAdvanced)} testID="text-advanced-toggle" />
      {showAdvanced && <LiteRTTextGenerationAdvanced />}
    </Card>
  );
};

// ─── Llama Settings ───────────────────────────────────────────────────────────

const LlamaTextSettings: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const modelMaxContext = useAppStore((s) => s.modelMaxContext);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const llmSliderMax = modelMaxContext ?? 32768;

  const maxTokens = settings?.maxTokens ?? 512;
  const contextLength = settings?.contextLength ?? 2048;

  return (
    <Card style={styles.section}>
      <Text style={styles.settingHelp}>Configure LLM behavior for text responses.</Text>

      <SliderSetting
        testID="llama-temperature"
        label="Temperature"
        description="Higher = more creative, Lower = more focused"
        value={settings?.temperature ?? 0.7}
        min={0} max={2} step={0.05} decimals={2}
        onChange={(value) => updateSettings({ temperature: value })}
      />

      <SliderSetting
        testID="llama-max-tokens"
        label="Max Tokens"
        description="Maximum response length"
        value={maxTokens}
        min={64} max={8192} step={64}
        formatValue={formatMaxTokens}
        onChange={(value) => updateSettings({ maxTokens: value })}
      />

      <SliderSetting
        testID="llama-context-length"
        label="Context Length"
        description="KV cache size — larger uses more RAM (requires reload)"
        warning={contextLength > 8192 ? 'High context uses significant RAM and may crash on some devices' : null}
        value={contextLength}
        min={512} max={llmSliderMax} step={1024}
        formatValue={formatContext}
        onChange={(value) => updateSettings({ contextLength: value })}
      />

      <ShowGenerationDetailsToggle />

      <AdvancedToggle isExpanded={showAdvanced} onPress={() => setShowAdvanced(!showAdvanced)} testID="text-advanced-toggle" />
      {showAdvanced && <TextGenerationAdvanced />}
    </Card>
  );
};

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export const TextGenerationSection: React.FC = () => {
  const isLiteRT = useAppStore(selectIsLiteRT);
  return isLiteRT ? <LiteRTTextSettings /> : <LlamaTextSettings />;
};
