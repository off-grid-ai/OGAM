import { remember } from '../../../src/language/review';
import { courseRate, SLOW_RATE } from '../../../src/language/slowVoice';
import { mistakeItemsFor } from '../../../src/language/wordPools';
import { languageService, MISTAKES } from '../../../src/language/languageService';
import { useLanguage } from '../../../src/language/store';

describe('the words you miss', () => {
  it('counts misses, and a right answer takes one off', () => {
    const miss = remember(undefined, false);
    expect(miss.misses).toBe(1);
    const twice = remember(miss, false);
    expect(twice.misses).toBe(2);
    expect(remember(twice, true).misses).toBe(1);
    expect(remember(remember(miss, true), true).misses).toBeUndefined();
  });

  it('lists the most missed first, and opens the lesson only with enough of them', () => {
    const items = ['uno', 'dos', 'tres', 'cuatro'].map((t) => ({ en: t, t }));
    useLanguage.setState({
      language: 'es-ES', content: { 'es-ES': { basics: items } }, myWords: {}, progress: { 'es-ES': { basics: { stars: 1, lessons: 1 } } },
      memory: { 'es-ES': { uno: { box: 1, due: 0, misses: 1 }, tres: { box: 1, due: 0, misses: 3 } } },
    });
    expect(mistakeItemsFor('es-ES').map((x) => x.t)).toEqual(['tres', 'uno']);
    expect(languageService.unlocked(MISTAKES, 'es-ES')).toBe(false);
    useLanguage.setState({ memory: { 'es-ES': { uno: { box: 1, due: 0, misses: 1 }, tres: { box: 1, due: 0, misses: 3 }, dos: { box: 1, due: 0, misses: 2 } } } });
    expect(mistakeItemsFor('es-ES').map((x) => x.t)).toEqual(['tres', 'dos', 'uno']);
    expect(languageService.unlocked(MISTAKES, 'es-ES')).toBe(true);
  });
});

describe('slower voice', () => {
  it('slows only the course\'s lines, and only when switched on', () => {
    useLanguage.setState({ slowVoice: false });
    expect(courseRate('lesson~3', 0.9)).toBe(0.9);
    useLanguage.setState({ slowVoice: true });
    expect(courseRate('lesson~3', 0.9)).toBe(SLOW_RATE);
    expect(courseRate('call~12', 1)).toBe(SLOW_RATE);
    expect(courseRate('phrase~4', 1)).toBe(1);
    expect(courseRate('lesson~3', 0.5)).toBe(0.5);
    useLanguage.setState({ slowVoice: false });
  });
});
