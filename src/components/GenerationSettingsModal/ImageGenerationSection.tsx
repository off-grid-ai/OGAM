import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AdvancedToggle } from '../AdvancedToggle';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { hardwareService } from '../../services';
import { createStyles } from './styles';
import { ImageQualityBasicSliders, ImageQualityAdvancedSliders } from './ImageQualitySliders';

// ─── Image Model Picker ───────────────────────────────────────────────────────

const ImageModelPicker: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { downloadedImageModels, activeImageModelId, setActiveImageModelId } = useAppStore();
  const [showPicker, setShowPicker] = useState(false);
  const activeImageModel = downloadedImageModels.find(m => m.id === activeImageModelId);

  const handleSelectNone = () => {
    setActiveImageModelId(null);
    setShowPicker(false);
  };

  return (
    <>
      <TouchableOpacity
        style={styles.modelPickerButton}
        onPress={() => setShowPicker(!showPicker)}
      >
        <View style={styles.modelPickerContent}>
          <Text style={styles.modelPickerLabel}>Image Model</Text>
          <Text style={styles.modelPickerValue}>
            {activeImageModel?.name || 'None selected'}
          </Text>
        </View>
        <Icon
          name={showPicker ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      {showPicker && (
        <View style={styles.modelPickerList}>
          {downloadedImageModels.length === 0 ? (
            <Text style={styles.noModelsText}>
              No image models downloaded. Go to Models tab to download one.
            </Text>
          ) : (
            <>
              <TouchableOpacity
                style={[
                  styles.modelPickerItem,
                  !activeImageModelId && styles.modelPickerItemActive,
                ]}
                onPress={handleSelectNone}
              >
                <Text style={styles.modelPickerItemText}>None (disable image gen)</Text>
                {!activeImageModelId && (
                  <Icon name="check" size={18} color={colors.primary} />
                )}
              </TouchableOpacity>
              {downloadedImageModels.map((model) => {
                const isActive = activeImageModelId === model.id;
                const handleSelect = () => {
                  setActiveImageModelId(model.id);
                  setShowPicker(false);
                };
                return (
                  <TouchableOpacity
                    key={model.id}
                    style={[styles.modelPickerItem, isActive && styles.modelPickerItemActive]}
                    onPress={handleSelect}
                  >
                    <View>
                      <Text style={styles.modelPickerItemText}>{model.name}</Text>
                      <Text style={styles.modelPickerItemDesc}>{model.style}</Text>
                    </View>
                    {isActive && <Icon name="check" size={18} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </View>
      )}
    </>
  );
};

// ─── Auto-Detect Method Toggle ────────────────────────────────────────────────

const AutoDetectMethodToggle: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.modeToggleInfo}>
        <Text style={styles.modeToggleLabel}>Detection Method</Text>
        <Text style={styles.modeToggleDesc}>
          {settings.autoDetectMethod === 'pattern'
            ? 'Fast keyword matching ("draw", "create image", etc.)'
            : 'Uses current text model for uncertain cases (slower)'}
        </Text>
      </View>
      <View style={styles.modeToggleButtons}>
        <TouchableOpacity
          style={[
            styles.modeButton,
            settings.autoDetectMethod === 'pattern' && styles.modeButtonActive,
          ]}
          onPress={() => updateSettings({ autoDetectMethod: 'pattern' })}
          testID="auto-detect-method-pattern"
        >
          <Text
            style={[
              styles.modeButtonText,
              settings.autoDetectMethod === 'pattern' && styles.modeButtonTextActive,
            ]}
          >
            Pattern
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.modeButton,
            settings.autoDetectMethod === 'llm' && styles.modeButtonActive,
          ]}
          onPress={() => updateSettings({ autoDetectMethod: 'llm' })}
          testID="auto-detect-method-llm"
        >
          <Text
            style={[
              styles.modeButtonText,
              settings.autoDetectMethod === 'llm' && styles.modeButtonTextActive,
            ]}
          >
            LLM
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ─── Classifier Model Picker ──────────────────────────────────────────────────

const ClassifierModelPicker: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { downloadedModels, settings, updateSettings } = useAppStore();
  const [showPicker, setShowPicker] = useState(false);
  const classifierModel = downloadedModels.find(m => m.id === settings.classifierModelId);

  const handleSelectNone = () => {
    updateSettings({ classifierModelId: null });
    setShowPicker(false);
  };

  return (
    <>
      <TouchableOpacity
        style={styles.modelPickerButton}
        onPress={() => setShowPicker(!showPicker)}
      >
        <View style={styles.modelPickerContent}>
          <Text style={styles.modelPickerLabel}>Classifier Model</Text>
          <Text style={styles.modelPickerValue}>
            {classifierModel?.name || 'Use current model'}
          </Text>
        </View>
        <Icon
          name={showPicker ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      {showPicker && (
        <View style={styles.modelPickerList}>
          <TouchableOpacity
            style={[
              styles.modelPickerItem,
              !settings.classifierModelId && styles.modelPickerItemActive,
            ]}
            onPress={handleSelectNone}
          >
            <View>
              <Text style={styles.modelPickerItemText}>Use current model</Text>
              <Text style={styles.modelPickerItemDesc}>No model switching needed</Text>
            </View>
            {!settings.classifierModelId && (
              <Icon name="check" size={18} color={colors.primary} />
            )}
          </TouchableOpacity>
          {downloadedModels.map((model) => {
            const isActive = settings.classifierModelId === model.id;
            const handleSelect = () => {
              updateSettings({ classifierModelId: model.id });
              setShowPicker(false);
            };
            const isFast = model.id.toLowerCase().includes('smol');
            return (
              <TouchableOpacity
                key={model.id}
                style={[styles.modelPickerItem, isActive && styles.modelPickerItemActive]}
                onPress={handleSelect}
              >
                <View style={styles.flex1}>
                  <Text style={styles.modelPickerItemText}>{model.name}</Text>
                  <Text style={styles.modelPickerItemDesc}>
                    {hardwareService.formatModelSize(model)}
                    {isFast && ' • Fast'}
                  </Text>
                </View>
                {isActive && <Icon name="check" size={18} color={colors.primary} />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      <Text style={styles.classifierNote}>
        Tip: Use a small model (SmolLM) for fast classification
      </Text>
    </>
  );
};

// ─── Advanced Section ────────────────────────────────────────────────────────

const ImageAdvancedSection: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings, downloadedModels } = useAppStore();
  const isAutoMode = settings.imageGenerationMode === 'auto';
  const isLlmDetect = settings.autoDetectMethod === 'llm';
  // Prompt enhancement runs a text model, so it needs one available.
  const hasTextModel = downloadedModels.length > 0;
  const enhanceOn = settings.enhanceImagePrompts && hasTextModel;

  return (
    <>
      <ImageQualityAdvancedSliders />
      {isAutoMode && <AutoDetectMethodToggle />}
      {isAutoMode && isLlmDetect && <ClassifierModelPicker />}
      <View style={[styles.modeToggleContainer, !hasTextModel && styles.dimmed]}>
        <View style={styles.modeToggleInfo}>
          <Text style={styles.modeToggleLabel}>Enhance Image Prompts</Text>
          <Text style={styles.modeToggleDesc}>
            {!hasTextModel
              ? 'Download a text model to enable prompt enhancement'
              : enhanceOn
                ? 'Text model refines your prompt before image generation (slower but better results)'
                : 'Use your prompt directly for image generation (faster)'}
          </Text>
        </View>
        <View style={styles.modeToggleButtons}>
          <TouchableOpacity
            style={[styles.modeButton, !enhanceOn && styles.modeButtonActive]}
            onPress={() => updateSettings({ enhanceImagePrompts: false })}
          >
            <Text style={[styles.modeButtonText, !enhanceOn && styles.modeButtonTextActive]}>
              Off
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, enhanceOn && styles.modeButtonActive]}
            disabled={!hasTextModel}
            onPress={() => updateSettings({ enhanceImagePrompts: true })}
          >
            <Text style={[styles.modeButtonText, enhanceOn && styles.modeButtonTextActive]}>
              On
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
};

// ─── Main Section ─────────────────────────────────────────────────────────────

export const ImageGenerationSection: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isAutoMode = settings.imageGenerationMode === 'auto';

  return (
    <View style={styles.sectionCard}>
      <ImageModelPicker />

      {/* Image Generation Mode Toggle */}
      <View style={styles.modeToggleContainer}>
        <View style={styles.modeToggleInfo}>
          <Text style={styles.modeToggleLabel}>Auto-detect image requests</Text>
          <Text style={styles.modeToggleDesc}>
            {isAutoMode
              ? 'Detects when you want to generate an image'
              : 'Use image button to manually trigger image generation'}
          </Text>
        </View>
        <View style={styles.modeToggleButtons}>
          <TouchableOpacity
            style={[styles.modeButton, isAutoMode && styles.modeButtonActive]}
            onPress={() => updateSettings({ imageGenerationMode: 'auto' })}
            testID="image-gen-mode-auto"
          >
            <Text style={[styles.modeButtonText, isAutoMode && styles.modeButtonTextActive]}>
              Auto
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, !isAutoMode && styles.modeButtonActive]}
            onPress={() => updateSettings({ imageGenerationMode: 'manual' })}
            testID="image-gen-mode-manual"
          >
            <Text style={[styles.modeButtonText, !isAutoMode && styles.modeButtonTextActive]}>
              Manual
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ImageQualityBasicSliders />

      <AdvancedToggle isExpanded={showAdvanced} onPress={() => setShowAdvanced(!showAdvanced)} testID="modal-image-advanced-toggle" />

      {showAdvanced && <ImageAdvancedSection />}
    </View>
  );
};
