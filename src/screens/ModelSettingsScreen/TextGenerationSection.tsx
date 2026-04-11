import React, { useState } from 'react';
import { View, Text, Switch } from 'react-native';
import { AdvancedToggle, Card } from '../../components';
import { NumericStepper } from '../../components/NumericStepper';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { createStyles } from './styles';
import { TextGenerationAdvanced } from './TextGenerationAdvanced';

const FALLBACK_MAX_CONTEXT = 32768;
const HIGH_CONTEXT_THRESHOLD = 8192;

export const TextGenerationSection: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const modelMaxContext = useAppStore((s) => s.modelMaxContext);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const trackColor = { false: colors.surfaceLight, true: `${colors.primary}80` };
  const maxTokens = settings?.maxTokens || 512;
  const maxTokensLabel = maxTokens >= 1024
    ? `${(maxTokens / 1024).toFixed(1)}K`
    : String(maxTokens);
  const contextLength = settings?.contextLength || 2048;
  const contextLengthLabel = contextLength >= 1024
    ? `${(contextLength / 1024).toFixed(0)}K`
    : String(contextLength);
  const ctxMax = modelMaxContext || FALLBACK_MAX_CONTEXT;

  return (
    <Card style={styles.section}>
      <Text style={styles.settingHelp}>Configure LLM behavior for text responses.</Text>

      <View style={styles.sliderSection}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>Temperature</Text>
        </View>
        <Text style={styles.sliderDesc}>Higher = more creative, Lower = more focused</Text>
        <NumericStepper
          value={settings?.temperature || 0.7}
          min={0} max={2} step={0.05} decimals={2}
          onChange={(value) => updateSettings({ temperature: value })}
        />
      </View>

      <View style={styles.sliderSection}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>Max Tokens</Text>
        </View>
        <Text style={styles.sliderDesc}>Maximum response length</Text>
        <NumericStepper
          value={maxTokens}
          min={64} max={8192} step={64}
          formatValue={() => maxTokensLabel}
          onChange={(value) => updateSettings({ maxTokens: value })}
        />
      </View>

      <View style={styles.sliderSection}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>Context Length</Text>
        </View>
        <Text style={styles.sliderDesc}>KV cache size — larger uses more RAM (requires reload)</Text>
        {contextLength > HIGH_CONTEXT_THRESHOLD && (
          <Text style={[styles.sliderDesc, { color: colors.error }]}>
            High context uses significant RAM and may crash on some devices
          </Text>
        )}
        <NumericStepper
          value={contextLength}
          min={512} max={ctxMax} step={1024}
          formatValue={() => contextLengthLabel}
          onChange={(value) => updateSettings({ contextLength: value })}
        />
      </View>

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

      <AdvancedToggle isExpanded={showAdvanced} onPress={() => setShowAdvanced(!showAdvanced)} testID="text-advanced-toggle" />

      {showAdvanced && <TextGenerationAdvanced />}
    </Card>
  );
};
