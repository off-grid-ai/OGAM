import React from 'react';
import { View, Text, Switch, Platform, TouchableOpacity } from 'react-native';
import { Button } from '../Button';
import { SliderSetting } from '../SliderSetting';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { useClearGpuCache, useImageParameterSettings } from '../../hooks/useImageGenerationSettings';
import {
  MAX_IMAGE_STEPS,
  SWEET_SPOT_SIZE,
} from '../../utils/imageGenAdvice';
import { createStyles } from './styles';

const ClearGPUCacheButton: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { clearing, handleClearCache } = useClearGpuCache();

  return (
    <TouchableOpacity
      style={[styles.settingHeader, styles.clearCacheButton, { backgroundColor: colors.surfaceLight }]}
      onPress={handleClearCache}
      disabled={clearing}
    >
      <Text style={[styles.settingDescription, { color: colors.primary }]}>
        {clearing ? 'Clearing...' : 'Clear GPU Cache'}
      </Text>
    </TouchableOpacity>
  );
};

/** Basic controls: Image Steps + Image Size */
export const ImageQualityBasicSliders: React.FC = () => {
  const { parameters, defaults, maxSize, applyDefaults } = useImageParameterSettings();
  const { settings, updateSettings } = useAppStore();

  return (
    <>
      <SliderSetting
        testID="image-steps"
        compact
        label="Image Steps"
        description="4-8 steps for speed, 20-50 for quality"
        value={parameters.steps}
        min={4} max={MAX_IMAGE_STEPS} step={1}
        onChange={(value) => updateSettings({ imageSteps: value })}
      />

      <SliderSetting
        testID="image-size"
        compact
        label="Image Size"
        description={`Output resolution. Recommended: ${defaults.size}x${defaults.size}.`}
        value={parameters.size}
        min={SWEET_SPOT_SIZE} max={maxSize} step={64}
        formatValue={(v) => `${v}x${v}`}
        onChange={(value) => updateSettings({ imageWidth: value, imageHeight: value })}
      />
      <Button title="Use model defaults" variant="secondary" size="small" onPress={applyDefaults} testID="image-model-defaults" />
    </>
  );
};

/** Advanced controls: Guidance Scale, Image Threads, GPU Acceleration */
export const ImageQualityAdvancedSliders: React.FC = () => {
  const { parameters } = useImageParameterSettings();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();

  return (
    <>
      <SliderSetting
        testID="guidance-scale"
        compact
        label="Guidance Scale"
        description="Higher = follows prompt more strictly (5-15 range)"
        value={parameters.guidanceScale}
        min={1} max={20} step={0.5} decimals={1}
        onChange={(value) => updateSettings({ imageGuidanceScale: value })}
      />

      <SliderSetting
        testID="image-threads"
        compact
        label="Image Threads"
        description="CPU threads used for image generation. Takes effect next time the image model loads."
        value={settings.imageThreads ?? 4}
        min={1} max={8} step={1}
        onChange={(value) => updateSettings({ imageThreads: value })}
      />

      {Platform.OS === 'android' && (
        <View style={styles.settingGroup}>
          <View style={styles.settingHeader}>
            <Text style={styles.settingLabel}>GPU Acceleration</Text>
            <Switch
              testID="image-gpu-acceleration"
              accessibilityLabel={`GPU Acceleration, ${
                (settings.imageUseOpenCL ?? true) ? 'ON' : 'OFF'
              }`}
              value={settings.imageUseOpenCL ?? true}
              onValueChange={(value) => updateSettings({ imageUseOpenCL: value })}
              trackColor={{ false: colors.surfaceLight, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>
          <Text style={styles.settingDescription}>
            Use GPU for faster image generation. First run may be slower while optimizing for your device.
          </Text>
          {(settings.imageUseOpenCL ?? true) && <ClearGPUCacheButton />}
        </View>
      )}
    </>
  );
};
