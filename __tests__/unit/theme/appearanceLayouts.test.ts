import { FONT_CHOICES, LAYOUT_MODES, type Appearance } from '../../../src/theme/appearance';
import { textAppearanceFor, adjustTextStyle } from '../../../src/theme/globalText';
import { getTheme } from '../../../src/theme/useTheme';

describe('Atlas visual modes and typography', () => {
  test('offers six genuinely separate modes and eight font choices', () => {
    expect(LAYOUT_MODES.map(x => x.id)).toEqual(['standard', 'simple', 'compact', 'colorful', 'grid', 'focus']);
    expect(new Set(FONT_CHOICES.map(f => f.body)).size).toBeGreaterThanOrEqual(5);
  });
  test('every font option is reactive for plain Text styles', () => {
    for (const font of FONT_CHOICES) {
      const settings: Appearance = { font: font.id, textSize: 'normal' };
      const state = textAppearanceFor(settings);
      expect(adjustTextStyle({ fontFamily: 'sans-serif', fontSize: 17 }, state))
        .toEqual(expect.objectContaining({ fontFamily: font.body }));
    }
  });
  test('simple and compact provide different spacing scales', () => {
    expect(getTheme('light', { layoutMode: 'simple' }).densityScale).toBeGreaterThan(1);
    expect(getTheme('light', { layoutMode: 'compact' }).densityScale).toBeLessThan(1);
    expect(getTheme('light', { layoutMode: 'standard' }).densityScale).toBe(1);
  });
  test('colorful mode modifies the background and accent while keeping readable text', () => {
    const standard = getTheme('light', { layoutMode: 'standard' });
    const vivid = getTheme('light', { layoutMode: 'colorful' });
    expect(vivid.colors.background).not.toBe(standard.colors.background);
    expect(vivid.colors.primary).not.toBe(standard.colors.primary);
    expect(vivid.colors.text).toBe(standard.colors.text);
  });
});
