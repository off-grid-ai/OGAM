import { useRef, useState } from 'react';
import { DEFAULT_SETTINGS, type AppSettings } from '../stores/appStore';
import { useAppStore } from '../stores';
import { useActiveMobileModel } from './useActiveMobileModel';
import { useModelsProjection } from './useApplicationProjection';
import {
  MIN_TEXT_CONTEXT_TOKENS,
  MIN_TEXT_OUTPUT_TOKENS,
  TEXT_SETTING_CONSTRAINTS,
  liteRTSettingLimits,
  modelsFailureMessage,
  textSettingLimits,
  updateTextContextLength,
  updateTextOutputTokens,
  type ModelSettingsRecord,
} from '@offgrid/application';
import { applicationFacade } from '../services/applicationFacade';

export interface NumericSettingModel {
  key: string;
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  formatValue?: (value: number) => string;
  warning?: string | null;
  onChange: (value: number) => void | Promise<void>;
}

const formatContext = (value: number): string =>
  value >= 1024 ? `${(value / 1024).toFixed(0)}K` : String(value);

const formatMaxTokens = (value: number): string =>
  value >= 1024 ? `${(value / 1024).toFixed(1)}K` : String(value);

/**
 * One headless settings model for both text-generation settings surfaces.
 * Shared Models owns selected values. Loaded model metadata owns both maxima.
 * Each surface owns only its layout and presentation.
 */
export function useTextGenerationSettings() {
  // The engine is a fact of the selected route's model, read from the one active route.
  const activeTextId = useActiveMobileModel('text').model?.id ?? null;
  const isLiteRT = useAppStore(
    state =>
      state.downloadedModels.find(m => m.id === activeTextId)?.engine ===
      'litert',
  );
  const settings = useModelsProjection().settings;
  const modelMaxContext = useAppStore(state => state.modelMaxContext);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const pendingRef = useRef(false);

  const save = async (patch: ModelSettingsRecord): Promise<void> => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    setSyncWarning(null);
    try {
      const outcome = await applicationFacade().models.settings.save({
        origin: 'local',
        patch,
      });
      if (!outcome.ok) {
        setFailure(modelsFailureMessage(outcome.failure));
      } else if (outcome.value.syncFailure) {
        setSyncWarning(
          `Saved on this device. ${modelsFailureMessage(
            outcome.value.syncFailure,
          )}`,
        );
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const numberSetting = (key: keyof AppSettings, fallback: number): number => {
    const value = settings[key];
    return typeof value === 'number' ? value : fallback;
  };

  const temperature = numberSetting(
    'temperature',
    DEFAULT_SETTINGS.temperature,
  );
  const maxTokens = numberSetting('maxTokens', DEFAULT_SETTINGS.maxTokens);
  const maxToolCalls = numberSetting(
    'maxToolCalls',
    DEFAULT_SETTINGS.maxToolCalls,
  );
  const contextLength = numberSetting(
    'contextLength',
    DEFAULT_SETTINGS.contextLength,
  );
  const topP = numberSetting('topP', DEFAULT_SETTINGS.topP);
  const repeatPenalty = numberSetting(
    'repeatPenalty',
    DEFAULT_SETTINGS.repeatPenalty,
  );
  const llamaLimits = textSettingLimits({
    contextLength,
    maxTokens,
    modelMaxContext,
  });

  const liteRTTemperature = numberSetting(
    'liteRTTemperature',
    DEFAULT_SETTINGS.liteRTTemperature,
  );
  const liteRTMaxTokens = numberSetting(
    'liteRTMaxTokens',
    DEFAULT_SETTINGS.liteRTMaxTokens,
  );
  const liteRTTopP = numberSetting('liteRTTopP', DEFAULT_SETTINGS.liteRTTopP);
  const liteRTLimits = liteRTSettingLimits({
    maxTokens: liteRTMaxTokens,
    modelMaxContext,
  });

  const toolCalls = {
    key: 'maxToolCalls',
    label: 'Maximum Tool Calls',
    description: 'Emergency limit for tool calls in one response',
    value: maxToolCalls,
    ...TEXT_SETTING_CONSTRAINTS.maxToolCalls,
    decimals: 0,
    onChange: (value: number) => save({ maxToolCalls: Math.round(value) }),
  } satisfies NumericSettingModel;

  const llama = {
    temperature: {
      key: 'temperature',
      label: 'Temperature',
      description: 'Higher = more creative, Lower = more focused',
      value: temperature,
      ...TEXT_SETTING_CONSTRAINTS.temperature,
      decimals: 2,
      onChange: (value: number) => save({ temperature: value }),
    },
    maxTokens: {
      key: 'maxTokens',
      label: 'Max Tokens',
      description: 'Maximum length of generated response',
      // Clamped for DISPLAY too: a value stored by an older build (or before the context came
      // down) must not render past the end of its own slider.
      value: llamaLimits.outputValue,
      min: MIN_TEXT_OUTPUT_TOKENS,
      max: llamaLimits.outputMaximum,
      step: 64,
      formatValue: formatMaxTokens,
      // Clamped on WRITE as well as on display: the slider cannot reach an illegal value, but
      // nothing else should be able to store one either.
      onChange: (value: number) =>
        save(updateTextOutputTokens(value, contextLength)),
    },
    contextLength: {
      key: 'contextLength',
      label: 'Context Length',
      description: 'KV cache size - larger uses more RAM (requires reload)',
      value: contextLength,
      min: MIN_TEXT_CONTEXT_TOKENS,
      max: llamaLimits.contextMaximum,
      step: 1024,
      formatValue: formatContext,
      warning: llamaLimits.contextWarning,
      // Lowering the context lowers what can be written into it. Without this the stored output
      // length silently stays above its own ceiling.
      onChange: (value: number) =>
        save(updateTextContextLength(value, maxTokens)),
    },
    topP: {
      key: 'topP',
      label: 'Top P',
      description: 'Nucleus sampling threshold',
      value: topP,
      ...TEXT_SETTING_CONSTRAINTS.topP,
      decimals: 2,
      onChange: (value: number) => save({ topP: value }),
    },
    repeatPenalty: {
      key: 'repeatPenalty',
      label: 'Repeat Penalty',
      description: 'Penalize repeated tokens',
      value: repeatPenalty,
      ...TEXT_SETTING_CONSTRAINTS.repeatPenalty,
      decimals: 2,
      onChange: (value: number) => save({ repeatPenalty: value }),
    },
  } satisfies Record<string, NumericSettingModel>;

  const liteRT = {
    temperature: {
      key: 'liteRTTemperature',
      label: 'Temperature',
      description: 'Higher = more creative, Lower = more focused',
      value: liteRTTemperature,
      ...TEXT_SETTING_CONSTRAINTS.temperature,
      decimals: 2,
      onChange: (value: number) => save({ liteRTTemperature: value }),
    },
    maxTokens: {
      key: 'liteRTMaxTokens',
      label: 'Max Tokens',
      description:
        'Total token budget - input, history, and output combined (requires reload)',
      value: liteRTMaxTokens,
      min: MIN_TEXT_CONTEXT_TOKENS,
      max: liteRTLimits.contextMaximum,
      step: 1024,
      formatValue: formatContext,
      warning: liteRTLimits.warning,
      onChange: (value: number) => save({ liteRTMaxTokens: value }),
    },
    topP: {
      key: 'liteRTTopP',
      label: 'Top P',
      description: 'Nucleus sampling threshold',
      value: liteRTTopP,
      ...TEXT_SETTING_CONSTRAINTS.topP,
      decimals: 2,
      onChange: (value: number) => save({ liteRTTopP: value }),
    },
  } satisfies Record<string, NumericSettingModel>;

  return { isLiteRT, llama, liteRT, toolCalls, pending, failure, syncWarning };
}
