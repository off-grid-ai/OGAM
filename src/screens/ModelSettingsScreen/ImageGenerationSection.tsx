import React, { useState } from 'react';
import { AppSwitch } from '../../components/AppSwitch';
import { View, Text, Platform } from 'react-native';
import { TouchableOpacity } from '../../components/Touchable';
import { AdvancedToggle, Card } from '../../components';
import { SliderSetting } from '../../components/SliderSetting';
import { Button } from '../../components/Button';
import { useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { useClearGpuCache, useImageParameterSettings } from '../../hooks/useImageGenerationSettings';
import {
  MAX_IMAGE_STEPS,
  SWEET_SPOT_SIZE,
} from '../../utils/imageGenAdvice';
import { createStyles } from './styles';

// ─── Advanced Sub-Components ─────────────────────────────────────────────────

const EnhanceImageToggle: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings, downloadedModels } = useAppStore();
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
        <Text style={styles.toggleLabel}>Enhance image prompts</Text>
        <Text style={styles.toggleDesc}>{description}</Text>
      </View>
      <AppSwitch
        value={enabled}
        disabled={!hasTextModel}
        onValueChange={(value) => updateSettings({ enhanceImagePrompts: value })}
      />
    </View>
  );
};

const ImageGpuSection: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const { clearing, handleClearCache } = useClearGpuCache();
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
        <AppSwitch
          value={isOpenCL}
          onValueChange={(value) => updateSettings({ imageUseOpenCL: value })}
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
  const { parameters, setParameter } = useImageParameterSettings();
  const { settings, updateSettings } = useAppStore();

  return (
    <>
      <SliderSetting
        testID="image-guidance-scale"
        label="Guidance Scale"
        description="Higher = follows prompt more strictly"
        value={parameters.guidanceScale}
        min={1} max={20} step={0.5} decimals={1}
        onChange={(value) => setParameter('cfgScale', value)}
      />

      <SliderSetting
        testID="image-threads"
        label="Image Threads"
        description="More is faster on phones with more cores."
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
  const { parameters, defaults, maxSize, applyDefaults, setParameter } = useImageParameterSettings();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isAutoMode = settings?.imageGenerationMode === 'auto';

  return (
    <Card style={styles.section}>
      <Text style={styles.settingHelp}>
        Control how image generation requests are handled in chat.
      </Text>

      {/* ── Basic Settings ── */}

      <View style={styles.toggleRow}>
        <View style={styles.toggleInfo}>
          <Text style={styles.toggleLabel}>Notice when you want a picture</Text>
          <Text style={styles.toggleDesc}>
            {isAutoMode
              ? 'Ask for a picture in plain words and it makes one.'
              : 'Pictures only when you turn on Image in the chat.'}
          </Text>
        </View>
        <AppSwitch
          value={isAutoMode}
          onValueChange={(value) =>
            updateSettings({ imageGenerationMode: value ? 'auto' : 'manual' })
          }
        />
      </View>
      <Text style={styles.toggleNote}>
        {isAutoMode
          ? '"Draw me a sunset" makes a picture when an image model is ready.'
          : 'Turn on Image in the chat menu when you want one.'}
      </Text>

      <SliderSetting
        testID="image-steps"
        label="Image steps"
        description="More steps look better and take longer. 4 to 8 is quick, 20 or more is detailed."
        value={parameters.steps}
        min={4} max={MAX_IMAGE_STEPS} step={1}
        onChange={(value) => setParameter('steps', value)}
      />

      <SliderSetting
        testID="image-size"
        label="Image size"
        description={`Output resolution. Recommended: ${defaults.size}x${defaults.size}.`}
        value={parameters.size}
        min={SWEET_SPOT_SIZE} max={maxSize} step={64}
        formatValue={(v) => `${v}x${v}`}
        onChange={(value) => setParameter('size', value)}
      />
      <Button title="Use model defaults" variant="secondary" size="small" onPress={applyDefaults} testID="image-model-defaults" />

      <AdvancedToggle isExpanded={showAdvanced} onPress={() => setShowAdvanced(!showAdvanced)} testID="image-advanced-toggle" />

      {showAdvanced && <ImageAdvancedSection />}
    </Card>
  );
};
