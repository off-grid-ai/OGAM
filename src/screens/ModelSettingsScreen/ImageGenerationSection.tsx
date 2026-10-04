import React, { useRef, useState } from 'react';
import { View, Text, Switch, Platform, TouchableOpacity } from 'react-native';
import { modelsFailureMessage, type ModelSettingsRecord } from '@offgrid/application';
import { AdvancedToggle, Card } from '../../components';
import { SliderSetting } from '../../components/SliderSetting';
import { Button } from '../../components/Button';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { useModelsProjection } from '../../hooks/useApplicationProjection';
import { useClearGpuCache } from '../../hooks/useImageGenerationSettings';
import {
  defaultImageSteps,
  MAX_IMAGE_STEPS,
  SWEET_SPOT_SIZE,
} from '../../utils/imageGenAdvice';
import { createStyles } from './styles';
import { applicationFacade } from '../../services/applicationFacade';

type SaveSettings = (patch: ModelSettingsRecord) => Promise<void>;

interface SaveState {
  pending: boolean;
  notice: { message: string; warning: boolean } | null;
  save: SaveSettings;
}

function useImageSettingsSave(): SaveState {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<SaveState['notice']>(null);
  const pendingRef = useRef(false);
  const save: SaveSettings = async patch => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setNotice(null);
    try {
      const outcome = await applicationFacade().models.settings.save({ origin: 'local', patch });
      if (!outcome.ok) setNotice({ message: modelsFailureMessage(outcome.failure), warning: false });
      else if (outcome.value.syncFailure) {
        setNotice({ message: `Saved on this device. ${modelsFailureMessage(outcome.value.syncFailure)}`, warning: true });
      }
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : String(error), warning: false });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  return { pending, notice, save };
}

// ─── Advanced Sub-Components ─────────────────────────────────────────────────

const EnhanceImageToggle: React.FC<SaveState> = ({ save, pending }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const enhanceImagePrompts = useModelsProjection().settings.enhanceImagePrompts;
  const trackColor = { false: colors.surfaceLight, true: `${colors.primary}80` };
  // Enhancement runs the prompt through a text model, so it needs one available. Only the
  // BOOLEAN matters, and it is computed in the selector, so downloading a second model does not
  // wake this row - it wakes only when the count crosses zero.
  const hasTextModel = useAppStore(s => s.downloadedModels.length > 0);
  const enabled = (enhanceImagePrompts ?? false) && hasTextModel;

  let description: string;
  if (!hasTextModel) {
    description = 'Download a text model to enable prompt enhancement';
  } else if (enhanceImagePrompts) {
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
        disabled={!hasTextModel || pending}
        onValueChange={(value) => save({ enhanceImagePrompts: value })}
        trackColor={trackColor}
        thumbColor={enabled ? colors.primary : colors.textMuted}
      />
    </View>
  );
};

const ImageGpuSection: React.FC<SaveState> = ({ save, pending }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const imageUseOpenCL = useModelsProjection().settings.imageUseOpenCL;
  const { clearing, handleClearCache } = useClearGpuCache();
  const trackColor = { false: colors.surfaceLight, true: `${colors.primary}80` };
  const isOpenCL = imageUseOpenCL ?? true;

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
          disabled={pending}
          onValueChange={(value) => save({ imageUseOpenCL: value })}
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

const DetectionMethodRow: React.FC<SaveState> = ({ save, pending }) => {
  const styles = useThemedStyles(createStyles);
  const { imageGenerationMode, autoDetectMethod } = useModelsProjection().settings;

  if (imageGenerationMode !== 'auto') return null;

  return (
    <View style={styles.settingSection}>
      <Text style={styles.settingLabel}>Detection Method</Text>
      <Text style={styles.settingDesc}>
        {autoDetectMethod === 'pattern'
          ? 'Fast keyword matching'
          : 'Uses text model for classification'}
      </Text>
      <View style={styles.buttonRow}>
        <Button
          title="Pattern"
          variant="secondary"
          size="medium"
          active={autoDetectMethod === 'pattern'}
          onPress={() => save({ autoDetectMethod: 'pattern' })}
          disabled={pending}
          style={styles.flex1}
        />
        <Button
          title="LLM"
          variant="secondary"
          size="medium"
          active={autoDetectMethod === 'llm'}
          onPress={() => save({ autoDetectMethod: 'llm' })}
          disabled={pending}
          style={styles.flex1}
        />
      </View>
    </View>
  );
};

// ─── Advanced Section ────────────────────────────────────────────────────────

const ImageAdvancedSection: React.FC<SaveState> = props => {
  const { imageGuidanceScale, imageThreads } = useModelsProjection().settings;

  return (
    <>
      <SliderSetting
        testID="image-guidance-scale"
        label="Guidance Scale"
        description="Higher = follows prompt more strictly"
        value={imageGuidanceScale || 7.5}
        min={1} max={20} step={0.5} decimals={1}
        onChange={(value) => props.save({ imageGuidanceScale: value })}
      />

      <SliderSetting
        testID="image-threads"
        label="Image Threads"
        description="CPU threads used for image generation (applies on next image model load)"
        value={imageThreads ?? 4}
        min={1} max={8} step={1}
        onChange={(value) => props.save({ imageThreads: value })}
      />

      <DetectionMethodRow {...props} />
      <EnhanceImageToggle {...props} />

      {Platform.OS === 'android' && <ImageGpuSection {...props} />}
    </>
  );
};

// ─── Main Section ────────────────────────────────────────────────────────────

export const ImageGenerationSection: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { imageSteps, imageWidth, imageGenerationMode } = useModelsProjection().settings;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const saveState = useImageSettingsSave();

  const isAutoMode = imageGenerationMode === 'auto';
  const trackColor = { false: colors.surfaceLight, true: `${colors.primary}80` };

  return (
    <Card style={styles.section}>
      <Text style={styles.settingHelp}>
        Control how image generation requests are handled in chat.
      </Text>
      {saveState.pending ? (
        <Text style={styles.draftWarning}>Saving settings...</Text>
      ) : saveState.notice ? (
        <Text style={saveState.notice.warning ? styles.draftWarning : styles.draftError} accessibilityLiveRegion="polite">
          {saveState.notice.message}
        </Text>
      ) : null}

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
          disabled={saveState.pending}
          onValueChange={(value) => saveState.save({ imageGenerationMode: value ? 'auto' : 'manual' })}
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
        value={imageSteps || defaultImageSteps(Platform.OS)}
        min={4} max={MAX_IMAGE_STEPS} step={1}
        onChange={(value) => saveState.save({ imageSteps: value })}
      />

      <SliderSetting
        testID="image-size"
        label="Image Size"
        description="Output resolution (smaller = faster, larger = more detail)"
        // Single source of truth for the floor: SD-class models render garbage below the
        // sweet spot (256), so both this screen and the chat modal (ImageQualitySliders) share
        // the SAME min/fallback — the surfaces can't diverge and a sub-256 value is unreachable.
        value={Math.max(SWEET_SPOT_SIZE, imageWidth ?? SWEET_SPOT_SIZE)}
        min={SWEET_SPOT_SIZE} max={512} step={64}
        formatValue={(v) => `${v}x${v}`}
        onChange={(value) => saveState.save({ imageWidth: value, imageHeight: value })}
      />

      <AdvancedToggle isExpanded={showAdvanced} onPress={() => setShowAdvanced(!showAdvanced)} testID="image-advanced-toggle" />

      {showAdvanced && <ImageAdvancedSection {...saveState} />}
    </Card>
  );
};
