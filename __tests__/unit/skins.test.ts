import { reshapeStyle } from '../../src/theme/useThemedStyles';
import { SKINS, shapeOf, PALETTES, ACCENTS, FONT_CHOICES } from '../../src/theme/appearance';

const card = { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, padding: 8 };

describe('skins', () => {
  it('square corners and heavy borders for the retro desktop', () => {
    const out = reshapeStyle(card, shapeOf('retro'), '#00f');
    expect(out).toMatchObject({ borderRadius: 0, borderWidth: 2, padding: 8 });
    expect(out.shadowOpacity).toBeUndefined();
  });
  it('bigger corners for iOS and Material, and a soft shadow on boxes for Aero', () => {
    expect(reshapeStyle(card, shapeOf('ios'), '#00f').borderRadius).toBe(18);
    expect(reshapeStyle(card, shapeOf('material'), '#00f').borderRadius).toBe(24);
    expect(reshapeStyle(card, shapeOf('aero'), '#00f')).toMatchObject({ shadowOpacity: 0.2, elevation: 3, borderRadius: 17 });
  });
  it('a glow in the accent color for neon, only on boxes, not on text or small chips', () => {
    expect(reshapeStyle(card, shapeOf('neon'), '#ff00aa')).toMatchObject({ shadowColor: '#ff00aa', shadowOpacity: 0.7 });
    expect(reshapeStyle({ color: '#fff', fontSize: 14 }, shapeOf('neon'), '#ff00aa').shadowOpacity).toBeUndefined();
    expect(reshapeStyle({ backgroundColor: '#fff', borderRadius: 3 }, shapeOf('neon'), '#ff00aa').shadowOpacity).toBeUndefined();
  });
  it('leaves the standard look alone', () => {
    expect(reshapeStyle(card, shapeOf(undefined), '#00f')).toEqual(card);
  });
  it('every skin points at a palette, accent and font that exist', () => {
    for (const skin of SKINS) {
      expect(PALETTES.some((p) => p.id === skin.look.palette)).toBe(true);
      expect(ACCENTS.some((a) => a.id === skin.look.accent)).toBe(true);
      expect(FONT_CHOICES.some((f) => f.id === skin.look.font)).toBe(true);
    }
    expect(SKINS.map((s) => s.id)).toEqual(expect.arrayContaining(['aero', 'retro', 'ios', 'terminal', 'xp', 'mac']));
  });
});
