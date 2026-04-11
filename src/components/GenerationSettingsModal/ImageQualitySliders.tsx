import React from 'react';
import { View, Text, Switch, Platform, TouchableOpacity } from 'react-native';
import { NumericStepper } from '../NumericStepper';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { useClearGpuCache } from '../../hooks/useImageGenerationSettings';
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
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();

  return (
    <>
      <View style={styles.settingGroup}>
        <Text style={styles.settingLabel}>Image Steps</Text>
        <Text style={styles.settingDescription}>4-8 steps for speed, 20-50 for quality</Text>
        <NumericStepper
          value={settings.imageSteps || 8}
          min={4} max={50} step={1}
          onChange={(value) => updateSettings({ imageSteps: value })}
        />
      </View>

      <View style={styles.settingGroup}>
        <Text style={styles.settingLabel}>Image Size</Text>
        <Text style={styles.settingDescription}>Output resolution (smaller = faster, larger = more detail)</Text>
        <NumericStepper
          value={settings.imageWidth ?? 256}
          min={128} max={512} step={64}
          formatValue={(v) => `${v}x${v}`}
          onChange={(value) => updateSettings({ imageWidth: value, imageHeight: value })}
        />
      </View>
    </>
  );
};

/** Advanced controls: Guidance Scale, Image Threads, GPU Acceleration */
export const ImageQualityAdvancedSliders: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();

  return (
    <>
      <View style={styles.settingGroup}>
        <Text style={styles.settingLabel}>Guidance Scale</Text>
        <Text style={styles.settingDescription}>Higher = follows prompt more strictly (5-15 range)</Text>
        <NumericStepper
          value={settings.imageGuidanceScale || 7.5}
          min={1} max={20} step={0.5} decimals={1}
          onChange={(value) => updateSettings({ imageGuidanceScale: value })}
        />
      </View>

      <View style={styles.settingGroup}>
        <Text style={styles.settingLabel}>Image Threads</Text>
        <Text style={styles.settingDescription}>CPU threads used for image generation. Takes effect next time the image model loads.</Text>
        <NumericStepper
          value={settings.imageThreads ?? 4}
          min={1} max={8} step={1}
          onChange={(value) => updateSettings({ imageThreads: value })}
        />
      </View>

      {Platform.OS === 'android' && (
        <View style={styles.settingGroup}>
          <View style={styles.settingHeader}>
            <Text style={styles.settingLabel}>GPU Acceleration</Text>
            <Switch
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
