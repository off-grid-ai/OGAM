import { Platform } from 'react-native';
import { useAppStore } from '../../stores';
import { INFERENCE_BACKENDS } from '../../types';
import { useTextGenerationSettings } from '../../hooks/useTextGenerationSettings';
import { useImageParameterSettings } from '../../hooks/useImageGenerationSettings';

type Numeric = { value: number; decimals?: number; formatValue?: (value: number) => string };

const show = (setting: Numeric): string =>
  setting.formatValue ? setting.formatValue(setting.value) : setting.value.toFixed(setting.decimals ?? 0);

const DEFAULT_PROMPT = 'You are a helpful AI assistant.';
const HARDWARE: Record<string, string> = {
  [INFERENCE_BACKENDS.CPU]: 'CPU',
  [INFERENCE_BACKENDS.METAL]: 'GPU',
  [INFERENCE_BACKENDS.OPENCL]: 'GPU',
  [INFERENCE_BACKENDS.HTP]: 'NPU',
};
const LOADING: Record<string, string> = { conservative: 'Lean', balanced: 'Balanced', aggressive: 'Aggressive' };

/** The values each closed section holds, read from the same hooks its controls write through. */
export const useSectionSummaries = () => {
  const settings = useAppStore(s => s.settings);
  const { isLiteRT, llama, liteRT } = useTextGenerationSettings();
  const { parameters } = useImageParameterSettings();

  const text = isLiteRT
    ? `Temperature ${show(liteRT.temperature)} · ${show(liteRT.maxTokens)} tokens`
    : `Temperature ${show(llama.temperature)} · ${show(llama.contextLength)} context · ${show(llama.maxTokens)} tokens`;

  // The same fallbacks the selectors show, so the closed row and the open controls agree.
  const backend = isLiteRT
    ? (settings.liteRTBackend === 'cpu' ? 'CPU' : 'GPU')
    : HARDWARE[settings.inferenceBackend ?? (Platform.OS === 'ios' ? INFERENCE_BACKENDS.METAL : INFERENCE_BACKENDS.CPU)] ?? 'CPU';
  const loading = settings.modelLoadingMode ?? (settings.aggressiveModelLoading ? 'aggressive' : 'balanced');

  return {
    general: `${backend} · ${LOADING[loading]} loading`,
    prompt: (settings.systemPrompt ?? DEFAULT_PROMPT).trim().split('\n')[0] || 'None',
    text,
    image: `${parameters.steps} steps · guidance ${parameters.guidanceScale} · ${parameters.size}px`,
  };
};
