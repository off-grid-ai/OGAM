import React from 'react';
import { View, Text, Switch, Platform, TouchableOpacity } from 'react-native';
import { SliderSetting } from '../SliderSetting';
import { useTheme, useThemedStyles } from '../../theme';
import { useResolvedImageGenerationSettings } from '../../hooks/useApplicationProjection';
import { useClearGpuCache } from '../../hooks/useImageGenerationSettings';
import { mobileImageQualityLimits } from '../../services/modelServices/imageGenerationApplication';
import { createStyles } from './styles';
import {
  ImageSettingsSaveNoticeText,
  useImageSettingsSave,
} from './useImageSettingsSave';

const ClearGPUCacheButton: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { clearing, handleClearCache } = useClearGpuCache();

  return (
    <TouchableOpacity
      style={[
        styles.settingHeader,
        styles.clearCacheButton,
        { backgroundColor: colors.surfaceLight },
      ]}
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
  // Two sliders, two fields. A whole-store read meant every step of the steps slider re-rendered
  // the size slider beside it, and every unrelated app write re-rendered both.
  const imageSettings = useResolvedImageGenerationSettings();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { pending, notice, save } = useImageSettingsSave();

  return (
    <>
      <ImageSettingsSaveNoticeText
        pending={pending}
        notice={notice}
        warningStyle={styles.settingWarning}
        errorStyle={[styles.settingWarning, { color: colors.error }]}
      />

      <SliderSetting
        testID="image-steps"
        label="Image Steps"
        description="4-8 steps for speed, 20-50 for quality"
        value={imageSettings.steps}
        min={4}
        max={mobileImageQualityLimits.maximumSteps}
        step={1}
        onChange={value => save({ imageSteps: value })}
      />

      <SliderSetting
        testID="image-size"
        label="Image Size"
        description="Output resolution. 256 is fastest with coherent results; 512 is most detailed but slow on GPU-only devices."
        value={imageSettings.width}
        min={mobileImageQualityLimits.minimumSize}
        max={512}
        step={64}
        formatValue={v => `${v}x${v}`}
        onChange={value => save({ imageWidth: value, imageHeight: value })}
      />
    </>
  );
};

/** Advanced controls: Guidance Scale, Image Threads, GPU Acceleration */
export const ImageQualityAdvancedSliders: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const imageSettings = useResolvedImageGenerationSettings();
  const { pending, notice, save } = useImageSettingsSave();

  return (
    <>
      <ImageSettingsSaveNoticeText
        pending={pending}
        notice={notice}
        warningStyle={styles.settingWarning}
        errorStyle={[styles.settingWarning, { color: colors.error }]}
      />

      <SliderSetting
        testID="guidance-scale"
        label="Guidance Scale"
        description="Higher = follows prompt more strictly (5-15 range)"
        value={imageSettings.guidanceScale}
        min={1}
        max={20}
        step={0.5}
        decimals={1}
        onChange={value => save({ imageGuidanceScale: value })}
      />

      <SliderSetting
        testID="image-threads"
        label="Image Threads"
        description="CPU threads used for image generation. Takes effect next time the image model loads."
        value={imageSettings.threads}
        min={1}
        max={8}
        step={1}
        onChange={value => save({ imageThreads: value })}
      />

      {Platform.OS === 'android' && (
        <View style={styles.settingGroup}>
          <View style={styles.settingHeader}>
            <Text style={styles.settingLabel}>GPU Acceleration</Text>
            <Switch
              testID="image-gpu-acceleration"
              accessibilityLabel={`GPU Acceleration, ${
                imageSettings.useOpenCL ? 'ON' : 'OFF'
              }`}
              value={imageSettings.useOpenCL}
              disabled={pending}
              onValueChange={value => save({ imageUseOpenCL: value })}
              trackColor={{ false: colors.surfaceLight, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>
          <Text style={styles.settingDescription}>
            Use GPU for faster image generation. First run may be slower while
            optimizing for your device.
          </Text>
          {imageSettings.useOpenCL && <ClearGPUCacheButton />}
        </View>
      )}
    </>
  );
};
