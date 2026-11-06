import { cardFill, cardSurface } from '../../../src/theme/surface';
import type { ThemeColors } from '../../../src/theme/palettes';

const colorsWith = (surface: string) => ({ surface, borderLight: '#222222' } as ThemeColors);

describe('cardFill', () => {
  it('lays a hex surface down mostly opaque, so the dot lattice does not show through', () => {
    expect(cardFill(colorsWith('#102030'))).toBe('rgba(16,32,48,0.9)');
  });

  it('keeps a surface that is not hex as it is', () => {
    expect(cardFill(colorsWith('rgba(1,2,3,1)'))).toBe('rgba(1,2,3,1)');
  });

  it('is the fill of the card surface', () => {
    expect(cardSurface(colorsWith('#102030')).backgroundColor).toBe(cardFill(colorsWith('#102030')));
  });
});
