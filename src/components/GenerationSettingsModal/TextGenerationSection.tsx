import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { AdvancedToggle } from '../AdvancedToggle';
import { SliderSetting } from '../SliderSetting';
import { useThemedStyles } from '../../theme';
import { createStyles } from './styles';
import {
  type NumericSettingModel,
  useTextGenerationSettings,
} from '../../hooks/useTextGenerationSettings';
import {
  BackendSelector,
  BatchSizeSlider,
  CpuThreadsSlider,
  FlashAttentionToggle,
  KvCacheTypeToggle,
  LiteRTBackendSelector,
  ModelLoadingModeSelector,
  ShowGenerationDetailsToggle,
  SpeculativeDecodingToggle,
  ThinkingBudgetSelector,
} from '../settings/textGenAdvancedSections';

const ChatSettingSlider: React.FC<{ setting: NumericSettingModel }> = ({
  setting,
}) => <SliderSetting testID={`setting-${setting.key}`} {...setting} />;

export const TextGenerationSection: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const {
    isLiteRT,
    llama,
    liteRT,
    toolCalls,
    pending,
    failure,
    syncWarning,
  } = useTextGenerationSettings();
  const basicSettings = isLiteRT
    ? [liteRT.temperature, liteRT.maxTokens]
    : [llama.temperature, llama.maxTokens, llama.contextLength];
  const advancedSettings = isLiteRT
    ? [liteRT.topP, toolCalls]
    : [llama.topP, llama.repeatPenalty, toolCalls];

  return (
    <View style={styles.sectionCard}>
      {pending ? (
        <Text style={styles.settingWarning} accessibilityLiveRegion="polite">
          Saving settings...
        </Text>
      ) : failure ? (
        <Text style={styles.actionTextError} accessibilityLiveRegion="polite">
          {failure}
        </Text>
      ) : syncWarning ? (
        <Text style={styles.settingWarning} accessibilityLiveRegion="polite">
          {syncWarning}
        </Text>
      ) : null}
      {basicSettings.map(setting => (
        <ChatSettingSlider key={setting.key} setting={setting} />
      ))}
      {!isLiteRT && <ThinkingBudgetSelector />}
      <ShowGenerationDetailsToggle />
      <AdvancedToggle
        isExpanded={showAdvanced}
        onPress={() => setShowAdvanced(current => !current)}
        testID="modal-text-advanced-toggle"
      />
      {showAdvanced ? (
        <>
          {advancedSettings.map(setting => (
            <ChatSettingSlider key={setting.key} setting={setting} />
          ))}
          {isLiteRT ? (
            <>
              <LiteRTBackendSelector />
              <ModelLoadingModeSelector />
            </>
          ) : (
            <>
              <CpuThreadsSlider />
              <BatchSizeSlider />
              <BackendSelector />
              <FlashAttentionToggle />
              <SpeculativeDecodingToggle />
              <KvCacheTypeToggle />
              <ModelLoadingModeSelector />
            </>
          )}
        </>
      ) : null}
    </View>
  );
};
