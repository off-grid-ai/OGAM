import { cardFill, cardSurface } from '../../../src/theme/surface';
import type { ThemeColors } from '../../../src/theme/palettes';

const colors = { surface: '#102030', surfaceGlass: 'rgba(16,32,48,0.55)', borderLight: '#222222' } as ThemeColors;

describe('cardFill', () => {
  it('is the glass surface, so the living field shows through, not the opaque surface', () => {
    expect(cardFill(colors)).toBe('rgba(16,32,48,0.55)');
    expect(cardFill(colors)).not.toBe(colors.surface);
  });

  it('is the fill of the card surface, edged with a hairline', () => {
    const surface = cardSurface(colors);
    expect(surface.backgroundColor).toBe(cardFill(colors));
    expect(surface.borderColor).toBe('#222222');
  });
});
