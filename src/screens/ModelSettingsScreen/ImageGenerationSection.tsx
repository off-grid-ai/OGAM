import React, { useState } from 'react';
import { View, Text, Switch, Platform, TouchableOpacity } from 'react-native';
import { AdvancedToggle, Card } from '../../components';
import { SliderSetting } from '../../components/SliderSetting';
import { Button } from '../../components/Button';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { useClearGpuCache } from '../../hooks/useImageGenerationSettings';
import { getImageTuning, getImageSizeSlider, isDirectSDXL, getImageGuidance } from '../../utils/nativeImageTuning';
import { createStyles } from './styles';
import { ImageBackendModePicker } from '../../components/ImageBackendModePicker';
import { ImageStylePicker } from '../../components/ImageStylePicker';

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
  const styles = useThemedStyles(createStyles);
  const { settings, activeImageModelId, downloadedImageModels } = useAppStore();
  const model = downloadedImageModels.find(m => m.id === activeImageModelId);
  const { clearing, handleClearCache } = useClearGpuCache();
  return (
    <>
      <ImageBackendModePicker backend={model?.backend} />
      {settings.imageBackendMode !== 'cpu' && model?.backend === 'mnn' && (
        <TouchableOpacity style={[styles.toggleRow, styles.clearCacheRow]}
          onPress={handleClearCache} disabled={clearing}>
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
  const { settings, updateSettings, activeImageModelId, downloadedImageModels } = useAppStore();
  const imageModel = downloadedImageModels.find(m => m.id === activeImageModelId);

  return (
    <>
      <SliderSetting
        testID="image-guidance-scale"
        label="Guidance Scale"
        description="Higher = follows prompt more strictly"
        value={getImageGuidance(imageModel, settings?.imageGuidanceScale)}
        min={1} max={20} step={0.5} decimals={1}
        onChange={(value) => updateSettings({ imageGuidanceScale: value })}
      />

      {(Platform.OS !== 'android' || imageModel?.backend === 'sdcpp') && (
        <SliderSetting
          testID="image-threads"
          label="Image Threads"
          description="CPU threads used for image generation (applies on next image model load)"
          value={settings?.imageThreads ?? 4}
          min={1} max={8} step={1}
          onChange={(value) => updateSettings({ imageThreads: value })}
        />
      )}

      <DetectionMethodRow />
      <ImageStylePicker />
      <EnhanceImageToggle />

      {Platform.OS === 'android' && <ImageGpuSection />}
    </>
  );
};

// ─── Main Section ────────────────────────────────────────────────────────────

export const ImageGenerationSection: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings, activeImageModelId, downloadedImageModels } = useAppStore();
  const imageModel = downloadedImageModels.find(m => m.id === activeImageModelId);
  const preset = getImageTuning(imageModel, settings);
  const sizeOptions = getImageSizeSlider(imageModel);
  const isXL = isDirectSDXL(imageModel);
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
        description={isXL ? "28 steps recommended for SDXL" : "More steps = better quality but slower (4-8 fast, 20-50 high quality)"}
        value={preset.steps}
        min={isXL ? 20 : 4} max={50} step={1}
        onChange={(value) => updateSettings({ imageSteps: value })}
      />

      <SliderSetting
        testID="image-size"
        label="Image Size"
        description={sizeOptions.description}
        value={preset.width}
        min={sizeOptions.min} max={sizeOptions.max} step={sizeOptions.step}
        formatValue={(v) => `${v}x${v}`}
        onChange={(value) => updateSettings({ imageWidth: value, imageHeight: value })}
      />

      <AdvancedToggle isExpanded={showAdvanced} onPress={() => setShowAdvanced(!showAdvanced)} testID="image-advanced-toggle" />

      {showAdvanced && <ImageAdvancedSection />}
    </Card>
  );
};
