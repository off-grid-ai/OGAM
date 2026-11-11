import { applyAppearanceColors } from '../../src/theme/appearance';
import { COLORS_DARK, COLORS_LIGHT } from '../../src/theme/palettes';

describe('Colorful mode', () => {
  it('changes the colors in both light and dark, and keeps a chosen accent', () => {
    for (const [base, dark] of [[COLORS_LIGHT, false], [COLORS_DARK, true]] as const) {
      const colorful = applyAppearanceColors(base, dark, { layoutMode: 'colorful' });
      expect(colorful.background).not.toBe(base.background);
      expect(colorful.primary).not.toBe(base.primary);
      const withAccent = applyAppearanceColors(base, dark, { layoutMode: 'colorful', accent: 'rose' });
      expect(withAccent.background).toBe(colorful.background);
      expect(withAccent.primary).not.toBe(colorful.primary);
    }
  });
});
