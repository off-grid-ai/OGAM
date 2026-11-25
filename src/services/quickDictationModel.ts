import { activeLocale } from '@offgrid/i18n';
import { whisperModelFor } from '@offgrid/speech';

/**
 * The Whisper model the mic's one-tap download offers: English-only for an English app, multilingual
 * (99 languages, same size) for every other app language, so dictation hears the person's language.
 */
export function quickDictationModelId(): string {
  return whisperModelFor(activeLocale().code);
}
