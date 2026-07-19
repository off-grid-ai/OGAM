import React, { useEffect, useState } from 'react';
import {
  Platform,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { Card } from '../components';
import { useAppStore } from '../stores';
import { useTheme, useThemedStyles } from '../theme';
import { createStyles } from './ExperimentalFeaturesScreen.styles';
import { hardwareService } from '../services/hardware';
import { INFERENCE_BACKENDS } from '../types';
import { SliderSetting } from '../components/SliderSetting';
import {
  GPU_LAYERS_MAX,
  useTextGenerationAdvanced,
} from '../hooks/useTextGenerationAdvanced';
import { HTP_ENABLED } from '../config/featureFlags';

const NpuAccelerationCard: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const { gpuLayersEffective } = useTextGenerationAdvanced();
  const [hasNpu, setHasNpu] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android' || !HTP_ENABLED) return;
    let active = true;
    hardwareService.getSoCInfo().then(info => {
      if (active) setHasNpu(info.hasNPU);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!hasNpu) return null;

  const enabled = settings.inferenceBackend === INFERENCE_BACKENDS.HTP;
  return (
    <Card style={styles.featureCard}>
      <View style={styles.featureRow}>
        <View style={styles.featureCopy}>
          <Text style={styles.featureTitle}>NPU Acceleration</Text>
          <Text style={styles.experimentalLabel}>BETA · EXPERIMENTAL</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={value =>
            updateSettings({
              inferenceBackend: value
                ? INFERENCE_BACKENDS.HTP
                : INFERENCE_BACKENDS.CPU,
            })
          }
          trackColor={{ false: colors.surfaceLight, true: colors.primary }}
          thumbColor={colors.text}
          accessibilityLabel="NPU Acceleration"
          accessibilityState={{ checked: enabled }}
          testID="experimental-npu-toggle"
        />
      </View>
      <Text style={styles.featureDescription}>
        Uses the Qualcomm Hexagon NPU for compatible GGUF models. Some model
        families may fall back to CPU or produce invalid output. Reload the
        model after changing this setting.
      </Text>
      {enabled && (
        <SliderSetting
          testID="experimental-npu-layers"
          label="NPU Layers"
          description="Layers offloaded to the NPU. Higher values can use more memory."
          value={gpuLayersEffective}
          min={1}
          max={GPU_LAYERS_MAX}
          step={1}
          onChange={value => updateSettings({ gpuLayers: value })}
        />
      )}
    </Card>
  );
};

export const ExperimentalFeaturesScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const enabled = useAppStore(state => state.settings.experimentalMtp);
  const updateSettings = useAppStore(state => state.updateSettings);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          testID="back-button"
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Experimental Features</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          These features are still being tested. They may change or behave
          differently across models and devices.
        </Text>
        <Card style={styles.featureCard}>
          <View style={styles.featureRow}>
            <View style={styles.featureCopy}>
              <Text style={styles.featureTitle}>Multi-Token Prediction</Text>
              <Text style={styles.experimentalLabel}>EXPERIMENTAL</Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={value =>
                updateSettings({ experimentalMtp: value })
              }
              trackColor={{ false: colors.surfaceLight, true: colors.primary }}
              thumbColor={colors.text}
              accessibilityLabel="Multi-Token Prediction"
              accessibilityState={{ checked: enabled }}
              testID="experimental-mtp-toggle"
            />
          </View>
          <Text style={styles.featureDescription}>
            Uses draft heads embedded in compatible GGUF models. May improve
            generation speed. Reload the model after changing this setting.
          </Text>
        </Card>
        <NpuAccelerationCard />
      </ScrollView>
    </SafeAreaView>
  );
};
