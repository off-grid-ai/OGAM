import { DEFAULT_SETTINGS } from '../stores/appStore';
import { selectIsLiteRT, useAppStore } from '../stores';
import {
  MAX_MAX_TOOL_CALLS,
  MIN_MAX_TOOL_CALLS,
  normalizeMaxToolCalls,
} from '@offgrid/models';

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
  onChange: (value: number) => void;
}

const formatContext = (value: number): string =>
  value >= 1024 ? `${(value / 1024).toFixed(0)}K` : String(value);

const formatMaxTokens = (value: number): string =>
  value >= 1024 ? `${(value / 1024).toFixed(1)}K` : String(value);

const MIN_MAX_TOKENS = 64;

/**
 * The most the model may WRITE, which the context it writes into is the ceiling for.
 *
 * Both sliders used to stop at the model's trained limit independently, so output could be set
 * above the context that has to hold it - a setting the engine can never honour, and one that
 * squeezes the prompt out of its own window. One rule, asked by the slider's ceiling and again when
 * the context is lowered underneath a value already chosen.
 */
const maxTokensCeiling = (contextLength: number): number =>
  Math.max(MIN_MAX_TOKENS, contextLength);

/**
 * One headless settings model for both text-generation settings surfaces.
 * The app store owns selected values. Loaded model metadata owns both maxima.
 * Each surface owns only its layout and presentation.
 */
export function useTextGenerationSettings() {
  const isLiteRT = useAppStore(selectIsLiteRT);
  const settings = useAppStore(state => state.settings);
  const updateSettings = useAppStore(state => state.updateSettings);
  const modelMaxContext = useAppStore(state => state.modelMaxContext);

  const temperature = settings.temperature ?? DEFAULT_SETTINGS.temperature;
  const maxTokens = settings.maxTokens ?? DEFAULT_SETTINGS.maxTokens;
  const maxToolCalls = settings.maxToolCalls ?? DEFAULT_SETTINGS.maxToolCalls;
  const contextLength =
    settings.contextLength ?? DEFAULT_SETTINGS.contextLength;
  const topP = settings.topP ?? DEFAULT_SETTINGS.topP;
  const repeatPenalty =
    settings.repeatPenalty ?? DEFAULT_SETTINGS.repeatPenalty;
  const llamaModelLimit =
    modelMaxContext ?? Math.max(maxTokens, contextLength, 512);

  const liteRTTemperature =
    settings.liteRTTemperature ?? DEFAULT_SETTINGS.liteRTTemperature;
  const liteRTMaxTokens =
    settings.liteRTMaxTokens ?? DEFAULT_SETTINGS.liteRTMaxTokens;
  const liteRTTopP = settings.liteRTTopP ?? DEFAULT_SETTINGS.liteRTTopP;
  const liteRTModelLimit = modelMaxContext ?? Math.max(liteRTMaxTokens, 512);

  const toolCalls = {
    key: 'maxToolCalls',
    label: 'Maximum Tool Calls',
    description: 'Emergency limit for tool calls in one response',
    value: maxToolCalls,
    min: MIN_MAX_TOOL_CALLS,
    max: MAX_MAX_TOOL_CALLS,
    step: 1,
    decimals: 0,
    onChange: (value: number) =>
      updateSettings({ maxToolCalls: normalizeMaxToolCalls(value) }),
  } satisfies NumericSettingModel;

  const llama = {
    temperature: {
      key: 'temperature',
      label: 'Temperature',
      description: 'Higher = more creative, Lower = more focused',
      value: temperature,
      min: 0,
      max: 2,
      step: 0.05,
      decimals: 2,
      onChange: (value: number) => updateSettings({ temperature: value }),
    },
    maxTokens: {
      key: 'maxTokens',
      label: 'Max Tokens',
      description: 'Maximum length of generated response',
      // Clamped for DISPLAY too: a value stored by an older build (or before the context came
      // down) must not render past the end of its own slider.
      value: Math.min(maxTokens, maxTokensCeiling(contextLength)),
      min: MIN_MAX_TOKENS,
      max: Math.min(llamaModelLimit, maxTokensCeiling(contextLength)),
      step: 64,
      formatValue: formatMaxTokens,
      // Clamped on WRITE as well as on display: the slider cannot reach an illegal value, but
      // nothing else should be able to store one either.
      onChange: (value: number) =>
        updateSettings({
          maxTokens: Math.min(value, maxTokensCeiling(contextLength)),
        }),
    },
    contextLength: {
      key: 'contextLength',
      label: 'Context Window',
      description: 'KV cache size - larger uses more RAM (requires reload)',
      value: contextLength,
      min: 512,
      max: llamaModelLimit,
      step: 1024,
      formatValue: formatContext,
      warning:
        contextLength > 8192
          ? 'High context uses significant RAM and may crash on some devices'
          : null,
      // Lowering the context lowers what can be written into it. Without this the stored output
      // length silently stays above its own ceiling.
      onChange: (value: number) =>
        updateSettings({
          contextLength: value,
          ...(maxTokens > maxTokensCeiling(value)
            ? { maxTokens: maxTokensCeiling(value) }
            : {}),
        }),
    },
    topP: {
      key: 'topP',
      label: 'Top P',
      description: 'Nucleus sampling threshold',
      value: topP,
      min: 0.1,
      max: 1,
      step: 0.05,
      decimals: 2,
      onChange: (value: number) => updateSettings({ topP: value }),
    },
    repeatPenalty: {
      key: 'repeatPenalty',
      label: 'Repeat Penalty',
      description: 'Penalize repeated tokens',
      value: repeatPenalty,
      min: 1,
      max: 2,
      step: 0.05,
      decimals: 2,
      onChange: (value: number) => updateSettings({ repeatPenalty: value }),
    },
  } satisfies Record<string, NumericSettingModel>;

  const liteRT = {
    temperature: {
      key: 'liteRTTemperature',
      label: 'Temperature',
      description: 'Higher = more creative, Lower = more focused',
      value: liteRTTemperature,
      min: 0,
      max: 2,
      step: 0.05,
      decimals: 2,
      onChange: (value: number) => updateSettings({ liteRTTemperature: value }),
    },
    maxTokens: {
      key: 'liteRTMaxTokens',
      label: 'Max Tokens',
      description:
        'Total token budget - input, history, and output combined (requires reload)',
      value: liteRTMaxTokens,
      min: 512,
      max: liteRTModelLimit,
      step: 1024,
      formatValue: formatContext,
      warning:
        liteRTMaxTokens > 8192
          ? 'High context uses significant RAM and may slow or crash on some devices'
          : null,
      onChange: (value: number) => updateSettings({ liteRTMaxTokens: value }),
    },
    topP: {
      key: 'liteRTTopP',
      label: 'Top P',
      description: 'Nucleus sampling threshold',
      value: liteRTTopP,
      min: 0.1,
      max: 1,
      step: 0.05,
      decimals: 2,
      onChange: (value: number) => updateSettings({ liteRTTopP: value }),
    },
  } satisfies Record<string, NumericSettingModel>;

  return { isLiteRT, llama, liteRT, toolCalls };
}
