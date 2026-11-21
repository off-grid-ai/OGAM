import { cardFill, cardLift, cardSurface } from '../../../src/theme/surface';
import { COLORS_DARK, COLORS_LIGHT, type ThemeColors } from '../../../src/theme/palettes';

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

describe('cardLift', () => {
  it('lays a light card on the page with a soft outer shadow under its top highlight', () => {
    const lift = cardLift(COLORS_LIGHT);
    expect(lift).toMatch(/^inset /);
    expect(lift).toMatch(/0px 6px 16px -6px rgba\(0,0,0,0\.14\)/);
    expect(cardSurface(COLORS_LIGHT).boxShadow).toBe(lift);
  });

  it('lifts a dark card with a brighter top edge, since a shadow barely shows on the dark field', () => {
    const lift = cardLift(COLORS_DARK);
    expect(lift).toMatch(/^inset 0px 1px 0px rgba\(255,255,255,0\.09\)/);
    expect(lift).not.toBe(cardLift(COLORS_LIGHT));
  });
});
