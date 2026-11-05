import { useAppStore } from '../../stores';
import { useTextGenerationSettings } from '../../hooks/useTextGenerationSettings';
import { useImageParameterSettings } from '../../hooks/useImageGenerationSettings';

type Numeric = { value: number; decimals?: number; formatValue?: (value: number) => string };

const show = (setting: Numeric): string =>
  setting.formatValue ? setting.formatValue(setting.value) : setting.value.toFixed(setting.decimals ?? 0);

/** The values each closed section holds, read from the same hooks its controls write through. */
export const useSectionSummaries = () => {
  const systemPrompt = useAppStore(s => s.settings.systemPrompt);
  const { isLiteRT, llama, liteRT } = useTextGenerationSettings();
  const { parameters } = useImageParameterSettings();

  const text = isLiteRT
    ? `Temperature ${show(liteRT.temperature)} · ${show(liteRT.maxTokens)} tokens`
    : `Temperature ${show(llama.temperature)} · ${show(llama.contextLength)} context · ${show(llama.maxTokens)} tokens`;

  return {
    prompt: systemPrompt?.trim().split('\n')[0] || null,
    text,
    image: `${parameters.steps} steps · guidance ${parameters.guidanceScale} · ${parameters.size}px`,
  };
};
