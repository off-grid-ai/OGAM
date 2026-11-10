import { APP_CONFIG, PREVIOUS_DEFAULT_SYSTEM_PROMPTS } from '../../../src/constants';
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

  it('reads a default an older build stored as the current built-in prompt', () => {
    expect(PREVIOUS_DEFAULT_SYSTEM_PROMPTS.length).toBeGreaterThan(0);
    for (const old of PREVIOUS_DEFAULT_SYSTEM_PROMPTS) {
      expect(resolveSystemPrompt(`${old}\n`)).toBe(APP_CONFIG.defaultSystemPrompt);
      expect(firstPrompt(undefined, old)).toBe(APP_CONFIG.defaultSystemPrompt);
      expect(isBuiltInPrompt(old)).toBe(true);
    }
  });

  it('leaves a prompt the person wrote untouched, and a project prompt still wins over an old default', () => {
    const mine = 'You are a helpful AI assistant. Answer in French.';
    expect(resolveSystemPrompt(mine)).toBe(mine);
    expect(isBuiltInPrompt(mine)).toBe(false);
    expect(resolveSystemPrompt('Project rules', PREVIOUS_DEFAULT_SYSTEM_PROMPTS[0])).toBe('Project rules');
  });
});

