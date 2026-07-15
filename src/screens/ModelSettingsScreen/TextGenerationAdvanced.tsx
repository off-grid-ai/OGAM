/**
 * Llama + LiteRT advanced text-generation panels for the Model Settings screen.
 *
 * The actual controls (backend, layers, flash attention, KV cache, aggressive
 * loading, CPU threads, batch size) are the SHARED section components in
 * ../../components/settings/textGenAdvancedSections — the SAME ones the in-chat
 * Generation Settings modal renders. This file only composes them + the two plain
 * sampling sliders. There is no second copy of the controls to drift from.
 */
import React from 'react';
import { SliderSetting } from '../../components/SliderSetting';
import { useAppStore } from '../../stores';
import {
  BackendSelector,
  LiteRTBackendSelector,
  FlashAttentionToggle,
  KvCacheTypeToggle,
  ModelLoadingModeSelector,
  CpuThreadsSlider,
  BatchSizeSlider,
} from '../../components/settings/textGenAdvancedSections';

export const TextGenerationAdvanced: React.FC = () => {
  const { settings, updateSettings } = useAppStore();

  return (
    <>
      <SliderSetting
        testID="llama-top-p"
        label="Top P"
        description="Nucleus sampling threshold"
        value={settings?.topP || 0.9}
        min={0.1} max={1.0} step={0.05} decimals={2}
        onChange={(value) => updateSettings({ topP: value })}
      />

      <SliderSetting
        testID="repeat-penalty"
        label="Repeat Penalty"
        description="Penalize repeated tokens"
        value={settings?.repeatPenalty || 1.1}
        min={1.0} max={2.0} step={0.05} decimals={2}
        onChange={(value) => updateSettings({ repeatPenalty: value })}
      />

      <CpuThreadsSlider />
      <BatchSizeSlider />
      <BackendSelector />
      <FlashAttentionToggle />
      <KvCacheTypeToggle />
      <ModelLoadingModeSelector />
    </>
  );
};

export const LiteRTTextGenerationAdvanced: React.FC = () => {
  const { settings, updateSettings } = useAppStore();

  return (
    <>
      <SliderSetting
        testID="litert-top-p"
        label="Top P"
        description="Nucleus sampling threshold"
        value={settings?.liteRTTopP || 0.9}
        min={0.1} max={1.0} step={0.05} decimals={2}
        onChange={(value) => updateSettings({ liteRTTopP: value })}
      />

      <LiteRTBackendSelector />
      <ModelLoadingModeSelector />
    </>
  );
};
