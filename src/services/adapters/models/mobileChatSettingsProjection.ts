import {
  chatGenerationRequestDefaults,
  type ChatTurn,
  type ModelSettingsRecord,
} from '@offgrid/application';
import { APP_CONFIG } from '../../../constants';
import { useAppStore } from '../../../stores';
import { DEFAULT_SETTINGS } from '../../../stores/appStore';
import { isLiteRTModel } from '../../../types';
import { applicationFacade } from '../../applicationFacade';
import { activeLocalModelId } from '../../modelServices/activeRoute';

/** Read the canonical committed Shared Models settings record. */
export function committedModelSettings(): ModelSettingsRecord {
  return applicationFacade().models.settings.current();
}

function stringSetting(
  record: ModelSettingsRecord,
  key: string,
  fallback: string,
): string {
  const value = record[key];
  return typeof value === 'string' ? value : fallback;
}

function numberSetting(
  record: ModelSettingsRecord,
  key: string,
  fallback: number,
): number {
  const value = record[key];
  return typeof value === 'number' ? value : fallback;
}

function booleanSetting(
  record: ModelSettingsRecord,
  key: string,
  fallback: boolean,
): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function optionalNumberSetting(
  record: ModelSettingsRecord,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

/** Project the committed prompt, with the application default for an unset value. */
export function committedSystemPrompt(): string {
  const prompt = stringSetting(committedModelSettings(), 'systemPrompt', '');
  return prompt || APP_CONFIG.defaultSystemPrompt;
}

/** Add Mobile runtime facts to canonical Shared generation defaults. */
export function mobileChatRequestDefaults(): ChatTurn['request']['request'] {
  const selected = useAppStore
    .getState()
    .downloadedModels.find(model => model.id === activeLocalModelId('text'));
  const settings = committedModelSettings();
  return {
    profile: 'chat',
    ...chatGenerationRequestDefaults({
      runtime: selected && isLiteRTModel(selected) ? 'litert' : 'standard',
      standard: {
        maxTokens: numberSetting(
          settings,
          'maxTokens',
          DEFAULT_SETTINGS.maxTokens,
        ),
        temperature: numberSetting(
          settings,
          'temperature',
          DEFAULT_SETTINGS.temperature,
        ),
        topP: numberSetting(settings, 'topP', DEFAULT_SETTINGS.topP),
        repetitionPenalty: numberSetting(
          settings,
          'repeatPenalty',
          DEFAULT_SETTINGS.repeatPenalty,
        ),
      },
      litert: {
        maxTokens: numberSetting(
          settings,
          'liteRTMaxTokens',
          DEFAULT_SETTINGS.liteRTMaxTokens,
        ),
        temperature: numberSetting(
          settings,
          'liteRTTemperature',
          DEFAULT_SETTINGS.liteRTTemperature,
        ),
        topP: numberSetting(
          settings,
          'liteRTTopP',
          DEFAULT_SETTINGS.liteRTTopP,
        ),
      },
      thinkingEnabled: booleanSetting(
        settings,
        'thinkingEnabled',
        DEFAULT_SETTINGS.thinkingEnabled,
      ),
      reasoningBudget: optionalNumberSetting(settings, 'reasoningBudget'),
      maxToolCalls: optionalNumberSetting(settings, 'maxToolCalls'),
    }),
  };
}
