import { APP_CONFIG } from '../../../src/constants';
import { firstPrompt, isBuiltInPrompt, resolveSystemPrompt } from '../../../src/utils/systemPrompt';

describe('system prompt resolver: a blank prompt is no prompt', () => {
  it('takes the first prompt with words, skipping blank ones', () => {
    expect(firstPrompt('\n', '  ', 'Be brief.')).toBe('Be brief.');
    expect(firstPrompt(undefined, null, 'Project rules', 'Default')).toBe('Project rules');
    expect(firstPrompt('\n', undefined)).toBeUndefined();
  });

  it('falls back to the built-in prompt when none has words', () => {
    expect(resolveSystemPrompt('\n', '')).toBe(APP_CONFIG.defaultSystemPrompt);
    expect(resolveSystemPrompt(undefined, 'Mine')).toBe('Mine');
  });

  it('treats blank and the untouched default as the built-in prompt', () => {
    expect(isBuiltInPrompt(undefined)).toBe(true);
    expect(isBuiltInPrompt(' \n ')).toBe(true);
    expect(isBuiltInPrompt(`  ${APP_CONFIG.defaultSystemPrompt}\n`)).toBe(true);
    expect(isBuiltInPrompt('Answer in French.')).toBe(false);
  });
});
