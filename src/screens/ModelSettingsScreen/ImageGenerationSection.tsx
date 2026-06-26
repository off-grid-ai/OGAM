import React, { useState } from 'react';
import { View, Text, Switch, Platform, TouchableOpacity } from 'react-native';
import { AdvancedToggle, Card } from '../../components';
import { SliderSetting } from '../../components/SliderSetting';
import { Button } from '../../components/Button';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { useClearGpuCache } from '../../hooks/useImageGenerationSettings';
import { createStyles } from './styles';

// ─── Advanced Sub-Components ─────────────────────────────────────────────────

const EnhanceImageToggle: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings, downloadedModels } = useAppStore();
  const trackColor = { false: colors.surfaceLight, true: `${colors.primary}80` };
  // Enhancement runs the prompt through a text model, so it needs one available.
  const hasTextModel = downloadedModels.length > 0;
  const enabled = (settings?.enhanceImagePrompts ?? false) && hasTextModel;

  let description: string;
  if (!hasTextModel) {
    description = 'Download a text model to enable prompt enhancement';
  } else if (settings?.enhanceImagePrompts) {
    description = 'Text model refines your prompt before image generation (slower but better results)';
  } else {
    description = 'Use your prompt directly for image generation (faster)';
  }

  return (
    <View style={[styles.toggleRow, !hasTextModel && styles.dimmed]}>
      <View style={styles.toggleInfo}>
        <Text style={styles.toggleLabel}>Enhance Image Prompts</Text>
        <Text style={styles.toggleDesc}>{description}</Text>
      </View>
      <Switch
        value={enabled}
        disabled={!hasTextModel}
        onValueChange={(value) => updateSettings({ enhanceImagePrompts: value })}
        trackColor={trackColor}
        thumbColor={enabled ? colors.primary : colors.textMuted}
      />
    </View>
  );
};

const ImageGpuSection: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const { clearing, handleClearCache } = useClearGpuCache();
  const trackColor = { false: colors.surfaceLight, true: `${colors.primary}80` };
  const isOpenCL = settings?.imageUseOpenCL ?? true;

  return (
    <>
      <View style={styles.toggleRow}>
        <View style={styles.toggleInfo}>
          <Text style={styles.toggleLabel}>OpenCL GPU Acceleration</Text>
          <Text style={styles.toggleDesc}>
            Use GPU for faster image generation. First run may be slower while optimizing for your device.
          </Text>
        </View>
        <Switch
          value={isOpenCL}
          onValueChange={(value) => updateSettings({ imageUseOpenCL: value })}
          trackColor={trackColor}
          thumbColor={isOpenCL ? colors.primary : colors.textMuted}
        />
      </View>
      {isOpenCL && (
        <TouchableOpacity
          style={[styles.toggleRow, styles.clearCacheRow]}
          onPress={handleClearCache}
          disabled={clearing}
        >
          <Text style={styles.clearCacheText}>
            {clearing ? 'Clearing...' : 'Clear GPU Cache'}
          </Text>
        </TouchableOpacity>
      )}
    </>
  );
};

const DetectionMethodRow: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();

  if (settings?.imageGenerationMode !== 'auto') return null;

  return (
    <View style={styles.settingSection}>
      <Text style={styles.settingLabel}>Detection Method</Text>
      <Text style={styles.settingDesc}>
        {settings?.autoDetectMethod === 'pattern'
          ? 'Fast keyword matching'
          : 'Uses text model for classification'}
      </Text>
      <View style={styles.buttonRow}>
        <Button
          title="Pattern"
          variant="secondary"
          size="medium"
          active={settings?.autoDetectMethod === 'pattern'}
          onPress={() => updateSettings({ autoDetectMethod: 'pattern' })}
          style={styles.flex1}
        />
        <Button
          title="LLM"
          variant="secondary"
          size="medium"
          active={settings?.autoDetectMethod === 'llm'}
          onPress={() => updateSettings({ autoDetectMethod: 'llm' })}
          style={styles.flex1}
        />
      </View>
    </View>
  );
};

// ─── Advanced Section ────────────────────────────────────────────────────────

const ImageAdvancedSection: React.FC = () => {
  const { settings, updateSettings } = useAppStore();

  return (
    <>
      <SliderSetting
        testID="image-guidance-scale"
        label="Guidance Scale"
        description="Higher = follows prompt more strictly"
        value={settings?.imageGuidanceScale || 7.5}
        min={1} max={20} step={0.5} decimals={1}
        onChange={(value) => updateSettings({ imageGuidanceScale: value })}
      />

      <SliderSetting
        testID="image-threads"
        label="Image Threads"
        description="CPU threads used for image generation (applies on next image model load)"
        value={settings?.imageThreads ?? 4}
        min={1} max={8} step={1}
        onChange={(value) => updateSettings({ imageThreads: value })}
      />

      <DetectionMethodRow />
      <EnhanceImageToggle />

      {Platform.OS === 'android' && <ImageGpuSection />}
    </>
  );
};

// ─── Main Section ────────────────────────────────────────────────────────────

export const ImageGenerationSection: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isAutoMode = settings?.imageGenerationMode === 'auto';
  const trackColor = { false: colors.surfaceLight, true: `${colors.primary}80` };

  return (
    <Card style={styles.section}>
      <Text style={styles.settingHelp}>
        Control how image generation requests are handled in chat.
      </Text>

      {/* ── Basic Settings ── */}

      <View style={styles.toggleRow}>
        <View style={styles.toggleInfo}>
          <Text style={styles.toggleLabel}>Automatic Detection</Text>
          <Text style={styles.toggleDesc}>
            {isAutoMode
              ? 'LLM will classify if your message is asking for an image'
              : 'Only generate images when you tap the image button'}
          </Text>
        </View>
        <Switch
          value={isAutoMode}
          onValueChange={(value) =>
            updateSettings({ imageGenerationMode: value ? 'auto' : 'manual' })
          }
          trackColor={trackColor}
          thumbColor={isAutoMode ? colors.primary : colors.textMuted}
        />
      </View>
      <Text style={styles.toggleNote}>
        {isAutoMode
          ? 'In Auto mode, messages like "Draw me a sunset" will automatically generate an image when an image model is loaded.'
          : 'In Manual mode, you must tap the IMG button in chat to generate images.'}
      </Text>

      <SliderSetting
        testID="image-steps"
        label="Image Steps"
        description="More steps = better quality but slower (4-8 fast, 20-50 high quality)"
        value={settings?.imageSteps || 8}
        min={4} max={50} step={1}
        onChange={(value) => updateSettings({ imageSteps: value })}
      />

      <SliderSetting
        testID="image-size"
        label="Image Size"
        description="Output resolution (smaller = faster, larger = more detail)"
        value={settings?.imageWidth ?? 256}
        min={128} max={512} step={64}
        formatValue={(v) => `${v}x${v}`}
        onChange={(value) => updateSettings({ imageWidth: value, imageHeight: value })}
      />

      <AdvancedToggle isExpanded={showAdvanced} onPress={() => setShowAdvanced(!showAdvanced)} testID="image-advanced-toggle" />

      {showAdvanced && <ImageAdvancedSection />}
    </Card>
  );
};
