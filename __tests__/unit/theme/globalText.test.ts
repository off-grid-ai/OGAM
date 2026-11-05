import { adjustTextStyle, installTextAppearance, setTextAppearance, textAppearanceFor } from '../../../src/theme/globalText';
import React from 'react';
import { create, act } from 'react-test-renderer';

const NEUTRAL = textAppearanceFor(undefined);

describe('global text appearance', () => {
  afterEach(() => act(() => setTextAppearance(NEUTRAL)));

  it('leaves text alone with the default font and size', () => {
    const style = { fontSize: 16 };
    expect(adjustTextStyle(style, NEUTRAL)).toBe(style);
  });

  it('scales inline sizes and line heights and follows the chosen font', () => {
    const a = textAppearanceFor({ font: 'mono', textSize: 'xlarge' });
    expect(adjustTextStyle({ fontSize: 20, lineHeight: 30 }, a)).toMatchObject({ fontSize: 26, lineHeight: 39, fontFamily: 'monospace' });
    // Text with no size at all uses React Native's 14 default.
    expect(adjustTextStyle([{ color: 'red' }], a)).toMatchObject({ fontSize: Math.round(14 * 1.3), color: 'red' });
  });

  it('keeps code monospace when the 8-bit font is chosen', () => {
    const a = textAppearanceFor({ font: 'pixel', textSize: 'normal' });
    expect(adjustTextStyle({ fontFamily: 'monospace' }, a)).toMatchObject({ fontFamily: 'monospace' });
  });

  it('keeps code in its own monospace face and maps serif headings to the chosen heading font', () => {
    const a = textAppearanceFor({ font: 'sans', textSize: 'normal' });
    expect(adjustTextStyle({ fontFamily: 'monospace' }, a)).toMatchObject({ fontFamily: 'monospace' });
    expect(adjustTextStyle({ fontFamily: 'serif' }, a)).toMatchObject({ fontFamily: 'sans-serif' });
  });

  it('re-renders text that is already on screen when the choice changes, and passes props and statics through', () => {
    const seen: any[] = [];
    // A stand-in for React Native's Text: a plain function component that records what it is asked to draw.
    const Fake: any = (props: any) => { seen.push(props); return null; };
    Fake.State = { marker: true };
    const mod: any = { default: Fake };
    installTextAppearance([mod]);
    const Patched: any = mod.default;
    expect(Patched).not.toBe(Fake);
    expect(Patched.State).toEqual({ marker: true });
    let tree: any;
    act(() => { tree = create(React.createElement(Patched, { style: { fontSize: 10 }, numberOfLines: 2 })); });
    expect(seen[seen.length - 1]).toEqual({ style: { fontSize: 10 }, numberOfLines: 2 });
    act(() => setTextAppearance(textAppearanceFor({ textSize: 'large' })));
    expect(seen[seen.length - 1]).toMatchObject({ style: { fontSize: 12 }, numberOfLines: 2 });
    act(() => tree.unmount());
    // Installing twice must not wrap twice.
    installTextAppearance([mod]);
    expect(mod.default).toBe(Patched);
  });

  it('patches the real React Native Text and TextInput modules in a normal run', () => {
    const textMod = require('react-native/Libraries/Text/Text');
    const before = textMod.default;
    installTextAppearance();
    expect(textMod.default.__atlasText || before.__atlasText).toBe(true);
    expect(require('react-native').Text).toBe(textMod.default);
  });
});

describe('nested text', () => {
  it('does not give an inner Text a size or font of its own', () => {
    const a = textAppearanceFor({ font: 'mono', textSize: 'large' });
    expect(adjustTextStyle({ fontWeight: 'bold' }, a, true)).toEqual({ fontWeight: 'bold' });
    expect(adjustTextStyle({ fontSize: 10 }, a, true)).toMatchObject({ fontSize: 12 });
  });
});

describe('icons', () => {
  it('keeps an icon font at the size the screen asked for', () => {
    const a = textAppearanceFor({ textSize: 'xlarge' });
    expect(adjustTextStyle({ fontSize: 22, fontFamily: 'Feather' }, a)).toMatchObject({ fontSize: 22, fontFamily: 'Feather' });
    expect(adjustTextStyle({ fontSize: 22, fontFamily: 'sans-serif-condensed' }, textAppearanceFor({ font: 'condensed', textSize: 'xlarge' }))).toMatchObject({ fontSize: 29 });
  });
});
