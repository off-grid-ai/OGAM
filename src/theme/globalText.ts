/**
 * Makes the Appearance font and text size apply to every piece of text at once, without a
 * restart. Many screens use plain inline or static styles (fontSize: 16, no fontFamily) that
 * never see the theme; instead of rewriting each one, Text and TextInput adjust their own
 * style as they render. A tiny store tells every mounted text when the choice changes.
 */
import React, { useSyncExternalStore } from 'react';
import { StyleSheet } from 'react-native';
import { FONT_CHOICES, TEXT_SIZES, type Appearance } from './appearance';

export interface TextAppearance { key: string; scale: number; heading: string; body: string }
const NEUTRAL: TextAppearance = { key: 'atlas:normal:standard', scale: 1, heading: 'serif', body: 'sans-serif' };

let current: TextAppearance = NEUTRAL;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => current;

export function textAppearanceFor(appearance?: Appearance): TextAppearance {
  const font = FONT_CHOICES.find(f => f.id === appearance?.font) ?? FONT_CHOICES[0];
  const size = TEXT_SIZES.find(t => t.id === appearance?.textSize) ?? TEXT_SIZES[1];
  const mode = appearance?.layoutMode ?? 'standard';
  return { key: `${font.id}:${size.id}:${mode}`, scale: size.scale * (mode === 'simple' ? 1.08 : 1), heading: font.heading, body: font.body };
}

/** Tell every mounted Text/TextInput about a new choice. */
export function setTextAppearance(next: TextAppearance): void {
  if (next.key === current.key) return;
  current = next;
  try { require('../utils/logger').default.log(`[FONT] appearance ${next.key} heading=${next.heading} body=${next.body}`); } catch { /* logger unavailable */ }
  listeners.forEach(l => l());
}
export const getTextAppearance = (): TextAppearance => current;

/** Plain system families the app uses by default; only these follow the chosen font. Code (monospace, Menlo) stays. */
const FOLLOWS_FONT = new Set(['sans-serif', 'serif', ...FONT_CHOICES.filter(f => f.id !== 'mono' && f.id !== 'pixel').flatMap(f => [f.heading, f.body])]);
/** Every family that is real text, so it scales; anything else (an icon font) does not. */
const TEXT_FAMILIES = new Set(['sans-serif', 'serif', 'monospace', 'Menlo', ...FONT_CHOICES.flatMap(f => [f.heading, f.body])]);

/** The style a text should render with under the given appearance. Returns the input untouched when nothing changes. */
export function adjustTextStyle(style: unknown, a: TextAppearance, nested = false): unknown {
  if (a.key === NEUTRAL.key) return style;
  const flat = (StyleSheet.flatten(style as any) ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...flat };
  const family = flat.fontFamily;
  // A Text inside another Text inherits the parent's family and size: only change what it sets itself.
  if (family === undefined) { if (!nested) out.fontFamily = a.body; }
  else if (typeof family === 'string' && FOLLOWS_FONT.has(family)) out.fontFamily = family === 'serif' ? a.heading : a.body;
  // Icon fonts (react-native-vector-icons draws icons as Text with their own family) keep their size.
  const textFamily = family === undefined || (typeof family === 'string' && TEXT_FAMILIES.has(family));
  if (a.scale !== 1 && textFamily) {
    const size = flat.fontSize;
    if (typeof size === 'number') out.fontSize = Math.round(size * a.scale);
    else if (!nested) out.fontSize = Math.round(14 * a.scale); // 14 is React Native's default
    if (typeof flat.lineHeight === 'number') out.lineHeight = Math.round(flat.lineHeight * a.scale);
  }
  return out;
}

/** React Native modules whose default export is the component, patched in place. Literal paths: Metro needs them. */
const TEXT_MODULE_COUNT = 2;
function reactNativeTextModules(): any[] {
  const out: any[] = [];
  try { out.push(require('react-native/Libraries/Text/Text')); } catch { out.push(null); }
  try { out.push(require('react-native/Libraries/Components/TextInput/TextInput')); } catch { out.push(null); }
  return out;
}

/**
 * Wraps a component so its style follows the chosen font and size. In this React Native
 * version Text and TextInput are plain function components (ref arrives as a prop), so the
 * wrapper just renders the original with an adjusted style and re-renders on a change.
 */
export function withTextAppearance<P extends { style?: unknown }>(Original: React.ComponentType<P>): React.ComponentType<P> {
  const Wrapped = function TextWithAppearance(props: P) {
    const a = useSyncExternalStore(subscribe, snapshot);
    const nested = !!React.useContext(ancestorContext());
    return React.createElement(Original as React.ComponentType<any>, a.key === NEUTRAL.key ? props : { ...props, style: adjustTextStyle(props.style, a, nested) });
  };
  Object.assign(Wrapped, Original); // statics such as TextInput.State
  (Wrapped as any).displayName = (Original as any).displayName ?? 'Text';
  (Wrapped as any).__atlasText = true;
  return Wrapped;
}

let ancestor: React.Context<unknown> | null = null;
/** React Native's own marker for "inside another Text". */
function ancestorContext(): React.Context<unknown> {
  if (!ancestor) {
    try { ancestor = require('react-native/Libraries/Text/TextAncestorContext').default; } catch { /* tests */ }
    ancestor = ancestor ?? React.createContext<unknown>(false);
  }
  return ancestor as React.Context<unknown>;
}

let installed = false;
/**
 * Replaces the default export of React Native's Text and TextInput modules once. Anything that
 * reads `Text` from react-native after this (every normal import) gets the wrapped version.
 * Call it before the app's screens load. `modules` is only for tests.
 */
export function installTextAppearance(modules: any[] = reactNativeTextModules()): void {
  if (installed && modules.length === TEXT_MODULE_COUNT) return;
  const result: string[] = [];
  for (const mod of modules) {
    const original = mod?.default;
    if (!original || original.__atlasText || (typeof original !== 'function' && typeof original !== 'object')) { result.push(original?.__atlasText ? 'already' : 'missing'); continue; }
    const wrapped = withTextAppearance(original);
    try { mod.default = wrapped; } catch { /* read-only export: define it below */ }
    if (mod.default !== wrapped) {
      try { Object.defineProperty(mod, 'default', { value: wrapped, configurable: true, enumerable: true, writable: true }); } catch { /* reported below */ }
    }
    result.push(mod.default === wrapped ? 'patched' : 'FAILED');
  }
  // Shows in Settings -> Debug Logs, so a font that does not change can be traced on the device.
  try { require('../utils/logger').default.log(`[FONT] text patch: ${result.join(', ')}`); } catch { /* logger unavailable */ }
  if (modules.length === TEXT_MODULE_COUNT) installed = true;
}

/** Patch Text/TextInput and follow the saved Appearance choice (including after it loads from disk). */
export function startTextAppearance(): void {
  installTextAppearance();
  const { useAppStore } = require('../stores/appStore');
  const apply = () => setTextAppearance(textAppearanceFor(useAppStore.getState().settings?.appearance));
  apply();
  useAppStore.subscribe(apply);
}
