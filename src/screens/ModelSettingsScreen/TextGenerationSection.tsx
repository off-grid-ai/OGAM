import React, { useState } from 'react';
import { Text } from 'react-native';
import { AdvancedToggle, Card } from '../../components';
import { SliderSetting } from '../../components/SliderSetting';
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
} from '../../components/settings/textGenAdvancedSections';
import { useTextGenerationSettings } from '../../hooks/useTextGenerationSettings';
import { useThemedStyles } from '../../theme';
import { createStyles } from './styles';

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

  return (
    <Card style={styles.section}>
      <Text style={styles.settingHelp}>
        {isLiteRT
          ? 'Configure LiteRT model behavior.'
          : 'Configure LLM behavior for text responses.'}
      </Text>
      {pending ? (
        <Text style={styles.draftWarning} accessibilityLiveRegion="polite">
          Saving settings...
        </Text>
      ) : failure ? (
        <Text style={styles.draftError} accessibilityLiveRegion="polite">
          {failure}
        </Text>
      ) : syncWarning ? (
        <Text style={styles.draftWarning} accessibilityLiveRegion="polite">
          {syncWarning}
        </Text>
      ) : null}

      {isLiteRT ? (
        <>
          <SliderSetting testID="litert-temperature" {...liteRT.temperature} />
          <SliderSetting testID="litert-max-tokens" {...liteRT.maxTokens} />
        </>
      ) : (
        <>
          <SliderSetting testID="llama-temperature" {...llama.temperature} />
          <SliderSetting testID="llama-max-tokens" {...llama.maxTokens} />
          <SliderSetting
            testID="llama-context-length"
            {...llama.contextLength}
          />
          <ThinkingBudgetSelector />
        </>
      )}

      <ShowGenerationDetailsToggle />
      <AdvancedToggle
        isExpanded={showAdvanced}
        onPress={() => setShowAdvanced(current => !current)}
        testID="text-advanced-toggle"
      />
      {showAdvanced ? (
        isLiteRT ? (
          <>
            <SliderSetting testID="litert-top-p" {...liteRT.topP} />
            <SliderSetting testID="max-tool-calls" {...toolCalls} />
            <LiteRTBackendSelector />
            <ModelLoadingModeSelector />
          </>
        ) : (
          <>
            <SliderSetting testID="llama-top-p" {...llama.topP} />
            <SliderSetting testID="repeat-penalty" {...llama.repeatPenalty} />
            <SliderSetting testID="max-tool-calls" {...toolCalls} />
            <CpuThreadsSlider />
            <BatchSizeSlider />
            <BackendSelector />
            <FlashAttentionToggle />
            <SpeculativeDecodingToggle />
            <KvCacheTypeToggle />
            <ModelLoadingModeSelector />
          </>
        )
      ) : null}
    </Card>
  );
};
