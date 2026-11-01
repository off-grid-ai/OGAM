/**
 * User appearance choices layered on the base light/dark palettes: a theme
 * (background family), an accent color, a font and a text size. One source for
 * the options so the settings screen and the theme hook agree.
 */
import { Platform } from 'react-native';
import { FONTS, TYPOGRAPHY } from '../constants';
import type { ThemeColors } from './palettes';

export type PaletteId = 'classic' | 'black' | 'forest' | 'ocean' | 'dusk' | 'paper' | 'mocha' | 'mint' | 'sakura' | 'graphite' | 'sunset' | 'contrast' | 'lavender' | 'peach' | 'navy';
export type AccentId = 'amber' | 'emerald' | 'blue' | 'violet' | 'rose' | 'teal' | 'red' | 'slate' | 'multi' | 'orange' | 'lime' | 'cyan' | 'indigo' | 'fuchsia' | 'gold';
export type FontId = 'atlas' | 'sans' | 'serif' | 'mono' | 'condensed' | 'light' | 'medium' | 'casual';
export type TextSizeId = 'small' | 'normal' | 'large' | 'xlarge';
export type LayoutMode = 'standard' | 'simple' | 'compact' | 'colorful' | 'grid' | 'focus';
export type Density = 'comfortable' | 'compact' | 'spacious';
/** How chat messages look: Clean = replies as plain text across the page with a bubble only for your own messages (like ChatGPT and Claude); Bubbles = every message in a box. */
export type ChatLayout = 'clean' | 'bubbles';
export const CHAT_LAYOUTS: Array<{ id: ChatLayout; name: string; hint: string }> = [
  { id: 'clean', name: 'Clean', hint: 'Replies as plain text, tighter spacing, wider on a tablet' },
  { id: 'bubbles', name: 'Bubbles', hint: 'Every message in a box (the earlier look)' },
];
export const LAYOUT_MODES: Array<{ id: LayoutMode; name: string; hint: string }> = [
  { id: 'standard', name: 'Standard', hint: 'Original Atlas home and layout' },
  { id: 'simple', name: 'Simple', hint: 'Large, labeled actions without clutter' },
  { id: 'compact', name: 'Compact', hint: 'Shortcuts and tighter spacing' },
  { id: 'colorful', name: 'Colorful', hint: 'Every part of the app in its own color' },
  { id: 'grid', name: 'Grid', hint: 'Big square tiles, two across' },
  { id: 'focus', name: 'Focus', hint: 'Only chat, learn and the briefing' },
];

export interface Appearance {
  palette?: PaletteId;
  accent?: AccentId;
  font?: FontId;
  textSize?: TextSizeId;
  layoutMode?: LayoutMode;
  density?: Density;
  chatLayout?: ChatLayout;
}

type Surfaces = Pick<ThemeColors, 'background' | 'surface' | 'surfaceLight' | 'surfaceHover' | 'border' | 'borderLight' | 'divider'>;
/** [background, surface, surfaceLight, surfaceHover, border, borderLight] */
const surfaces = (c: [string, string, string, string, string, string]): Surfaces =>
  ({ background: c[0], surface: c[1], surfaceLight: c[2], surfaceHover: c[3], border: c[4], borderLight: c[5], divider: c[2] });

export const PALETTES: Array<{ id: PaletteId; name: string; light?: Surfaces; dark?: Surfaces }> = [
  { id: 'classic', name: 'Atlas' },
  { id: 'black', name: 'True black',
    light: surfaces(['#FFFFFF', '#F4F4F4', '#EAEAEA', '#DDDDDD', '#E2E2E2', '#D0D0D0']),
    dark: surfaces(['#000000', '#0E0E0E', '#181818', '#222222', '#1E1E1E', '#2A2A2A']) },
  { id: 'forest', name: 'Forest',
    light: surfaces(['#F4F8F1', '#E8F0E2', '#DCE8D3', '#CFDEC4', '#D3E0C9', '#C0D2B3']),
    dark: surfaces(['#0C1610', '#132119', '#1A2C22', '#22382B', '#1F3326', '#294234']) },
  { id: 'ocean', name: 'Ocean',
    light: surfaces(['#F2F7FB', '#E4EEF6', '#D6E5F0', '#C7DAE9', '#CFDFEC', '#BACFE0']),
    dark: surfaces(['#08131F', '#0F1D2C', '#16283A', '#1E3449', '#1A2E42', '#243B53']) },
  { id: 'dusk', name: 'Dusk',
    light: surfaces(['#F8F4FA', '#EEE6F3', '#E3D7EB', '#D7C8E2', '#DDD0E6', '#CBBAD8']),
    dark: surfaces(['#130E1A', '#1C1526', '#251D33', '#2F2541', '#2A2139', '#362B48']) },
  { id: 'paper', name: 'Paper',
    light: surfaces(['#FFFDF7', '#F7F2E4', '#EFE7D3', '#E6DCC3', '#E9DFC8', '#D9CCAF']),
    dark: surfaces(['#1A1712', '#231F18', '#2C271F', '#363027', '#332D24', '#40392E']) },
  { id: 'mocha', name: 'Mocha',
    light: surfaces(['#FBF6F2', '#F1E6DE', '#E6D5C8', '#DAC5B5', '#E0CFC2', '#CDB6A4']),
    dark: surfaces(['#171110', '#211918', '#2B2120', '#362A28', '#312624', '#42332F']) },
  { id: 'mint', name: 'Mint',
    light: surfaces(['#F2FBF7', '#E1F4EB', '#D1ECDF', '#C0E3D3', '#C9E8D9', '#B0D9C6']),
    dark: surfaces(['#0A1512', '#10211C', '#162C26', '#1D3832', '#1A322B', '#254139']) },
  { id: 'sakura', name: 'Sakura',
    light: surfaces(['#FFF7F9', '#FBE9EE', '#F6D9E1', '#F0C8D3', '#F2D3DC', '#E7BDC9']),
    dark: surfaces(['#1A0F13', '#25161B', '#301E24', '#3B272E', '#36222A', '#48303A']) },
  { id: 'graphite', name: 'Graphite',
    light: surfaces(['#F5F6F7', '#E9EBED', '#DCDFE2', '#CED2D6', '#D8DCDF', '#C3C8CC']),
    dark: surfaces(['#121416', '#1A1D20', '#23272B', '#2D3236', '#292D31', '#383E43']) },
  { id: 'sunset', name: 'Sunset',
    light: surfaces(['#FFF8F1', '#FDEBDA', '#F9DCC3', '#F4CCAB', '#F6D5BB', '#EBBF9F']),
    dark: surfaces(['#1A100C', '#261811', '#32211A', '#3F2B22', '#3A261D', '#4E352A']) },
  { id: 'contrast', name: 'High contrast',
    light: surfaces(['#FFFFFF', '#FFFFFF', '#F0F0F0', '#E0E0E0', '#000000', '#333333']),
    dark: surfaces(['#000000', '#000000', '#141414', '#222222', '#FFFFFF', '#CCCCCC']) },
  { id: 'lavender', name: 'Lavender',
    light: surfaces(['#F7F5FF', '#ECE8FB', '#E0DAF6', '#D3CBF0', '#DAD3F2', '#C6BCE9']),
    dark: surfaces(['#110F1E', '#1A1730', '#231F40', '#2E2951', '#28234A', '#3A3463']) },
  { id: 'peach', name: 'Peach',
    light: surfaces(['#FFF6F2', '#FDE8DF', '#F9D9CB', '#F4C9B6', '#F5D3C4', '#EBBDA9']),
    dark: surfaces(['#1B100D', '#281813', '#34211A', '#412C23', '#3B261E', '#503529']) },
  { id: 'navy', name: 'Navy',
    light: surfaces(['#F3F5FA', '#E5E9F4', '#D6DDEE', '#C6D0E6', '#CED6EA', '#B7C2DD']),
    dark: surfaces(['#070B17', '#0D1426', '#141D36', '#1C2745', '#18223D', '#26335A']) },
];

type Accent = Pick<ThemeColors, 'primary' | 'primaryDark' | 'primaryLight'>;
export const ACCENTS: Array<{ id: AccentId; name: string; light: Accent; dark: Accent }> = [
  { id: 'amber', name: 'Amber', light: { primary: '#B3620F', primaryDark: '#8F4C08', primaryLight: '#D98E3A' }, dark: { primary: '#F2A93B', primaryDark: '#D98E1F', primaryLight: '#F8C56E' } },
  { id: 'emerald', name: 'Emerald', light: { primary: '#047857', primaryDark: '#065F46', primaryLight: '#10B981' }, dark: { primary: '#34D399', primaryDark: '#10B981', primaryLight: '#6EE7B7' } },
  { id: 'blue', name: 'Blue', light: { primary: '#1D4ED8', primaryDark: '#1E3A8A', primaryLight: '#3B82F6' }, dark: { primary: '#60A5FA', primaryDark: '#3B82F6', primaryLight: '#93C5FD' } },
  { id: 'violet', name: 'Violet', light: { primary: '#6D28D9', primaryDark: '#5B21B6', primaryLight: '#8B5CF6' }, dark: { primary: '#A78BFA', primaryDark: '#8B5CF6', primaryLight: '#C4B5FD' } },
  { id: 'rose', name: 'Rose', light: { primary: '#BE185D', primaryDark: '#9D174D', primaryLight: '#EC4899' }, dark: { primary: '#F472B6', primaryDark: '#EC4899', primaryLight: '#F9A8D4' } },
  { id: 'teal', name: 'Teal', light: { primary: '#0F766E', primaryDark: '#115E59', primaryLight: '#14B8A6' }, dark: { primary: '#2DD4BF', primaryDark: '#14B8A6', primaryLight: '#5EEAD4' } },
  { id: 'red', name: 'Red', light: { primary: '#B91C1C', primaryDark: '#991B1B', primaryLight: '#EF4444' }, dark: { primary: '#F87171', primaryDark: '#EF4444', primaryLight: '#FCA5A5' } },
  // Multicolor: the app's main color is blue, and each section of the app (the bottom tabs) wears its own color (see SECTION_COLORS).
  { id: 'orange', name: 'Orange', light: { primary: '#C2410C', primaryDark: '#9A3412', primaryLight: '#F97316' }, dark: { primary: '#FB923C', primaryDark: '#F97316', primaryLight: '#FDBA74' } },
  { id: 'lime', name: 'Lime', light: { primary: '#4D7C0F', primaryDark: '#3F6212', primaryLight: '#84CC16' }, dark: { primary: '#A3E635', primaryDark: '#84CC16', primaryLight: '#BEF264' } },
  { id: 'cyan', name: 'Cyan', light: { primary: '#0E7490', primaryDark: '#155E75', primaryLight: '#06B6D4' }, dark: { primary: '#22D3EE', primaryDark: '#06B6D4', primaryLight: '#67E8F9' } },
  { id: 'indigo', name: 'Indigo', light: { primary: '#4338CA', primaryDark: '#3730A3', primaryLight: '#6366F1' }, dark: { primary: '#818CF8', primaryDark: '#6366F1', primaryLight: '#A5B4FC' } },
  { id: 'fuchsia', name: 'Fuchsia', light: { primary: '#A21CAF', primaryDark: '#86198F', primaryLight: '#D946EF' }, dark: { primary: '#E879F9', primaryDark: '#D946EF', primaryLight: '#F0ABFC' } },
  { id: 'gold', name: 'Gold', light: { primary: '#A16207', primaryDark: '#854D0E', primaryLight: '#EAB308' }, dark: { primary: '#FACC15', primaryDark: '#EAB308', primaryLight: '#FDE047' } },
  { id: 'multi', name: 'Multicolor', light: { primary: '#1D4ED8', primaryDark: '#1E3A8A', primaryLight: '#3B82F6' }, dark: { primary: '#60A5FA', primaryDark: '#3B82F6', primaryLight: '#93C5FD' } },
  { id: 'slate', name: 'Slate', light: { primary: '#334155', primaryDark: '#1E293B', primaryLight: '#64748B' }, dark: { primary: '#CBD5E1', primaryDark: '#94A3B8', primaryLight: '#E2E8F0' } },
];

/** Each part of the app's own color in Multicolor mode: [light, dark]. */
export const SECTION_COLORS: Record<string, [string, string]> = {
  HomeTab: ['#1D4ED8', '#60A5FA'], ChatsTab: ['#047857', '#34D399'], ProjectsTab: ['#B3620F', '#F2A93B'],
  LanguageTab: ['#6D28D9', '#A78BFA'], ModelsTab: ['#0F766E', '#2DD4BF'], SettingsTab: ['#BE185D', '#F472B6'],
  EmergencyTab: ['#B91C1C', '#F87171'], LibraryTab: ['#0F766E', '#2DD4BF'], BriefTab: ['#B3620F', '#F2A93B'],
  CompassTab: ['#1D4ED8', '#60A5FA'], PhrasesTab: ['#6D28D9', '#A78BFA'], RecorderTab: ['#BE185D', '#F472B6'], SurvivalTab: ['#047857', '#34D399'],
};
export const sectionColor = (route: string, isDark: boolean): string | undefined => SECTION_COLORS[route]?.[isDark ? 1 : 0];

/**
 * Fonts bundled with Atlas (android/app/src/main/assets/fonts, SIL Open Font License), so
 * every choice looks the same on every device. Android's own family names (serif, casual,
 * sans-serif-condensed...) are not reliable: Motorola, Samsung and others let the system font
 * replace them all, so on those phones every choice looked the same. "Atlas" keeps the
 * system look. Other platforms use their system families.
 */
const bundled = (file: string, system: string) => (Platform.OS === 'android' ? file : system);
export const FONT_CHOICES: Array<{ id: FontId; name: string; heading: string; body: string }> = [
  { id: 'atlas', name: 'Atlas', heading: 'serif', body: 'sans-serif' },
  { id: 'sans', name: 'Clean', heading: bundled('AtlasClean', 'sans-serif'), body: bundled('AtlasClean', 'sans-serif') },
  { id: 'serif', name: 'Book', heading: bundled('AtlasBook', 'serif'), body: bundled('AtlasBook', 'serif') },
  { id: 'mono', name: 'Terminal', heading: bundled('AtlasMono', 'monospace'), body: bundled('AtlasMono', 'monospace') },
  { id: 'condensed', name: 'Narrow', heading: bundled('AtlasNarrow', 'sans-serif-condensed'), body: bundled('AtlasNarrow', 'sans-serif-condensed') },
  { id: 'light', name: 'Light', heading: bundled('AtlasLight', 'sans-serif-light'), body: bundled('AtlasLight', 'sans-serif-light') },
  { id: 'medium', name: 'Bold', heading: bundled('AtlasBold', 'sans-serif-medium'), body: bundled('AtlasBold', 'sans-serif-medium') },
  { id: 'casual', name: 'Handwritten', heading: bundled('AtlasHand', 'casual'), body: bundled('AtlasHand', 'casual') },
];

export const TEXT_SIZES: Array<{ id: TextSizeId; name: string; scale: number }> = [
  { id: 'small', name: 'Small', scale: 0.9 },
  { id: 'normal', name: 'Normal', scale: 1 },
  { id: 'large', name: 'Large', scale: 1.15 },
  { id: 'xlarge', name: 'Extra large', scale: 1.3 },
];

/** Applies palette + accent on top of a base light/dark palette. */
export function applyAppearanceColors(base: ThemeColors, isDark: boolean, appearance?: Appearance): ThemeColors {
  if (!appearance) return base;
  const palette = PALETTES.find(p => p.id === appearance.palette);
  const accent = ACCENTS.find(a => a.id === appearance.accent);
  const bg = palette && (isDark ? palette.dark : palette.light);
  const ac = accent && (isDark ? accent.dark : accent.light);
  const colorful = appearance.layoutMode === 'colorful';
  const colorfulAccent = isDark ? ACCENTS[3].dark : ACCENTS[5].light;
  const colorfulSurfaces = isDark
    ? surfaces(['#11152B', '#211D38', '#252F43', '#303950', '#3E4160', '#545B77'])
    : surfaces(['#F3F6FF', '#FFF9EC', '#E8F6F3', '#DFF0FF', '#D4DEED', '#B6CEED']);
  if (!bg && !ac && !colorful) return base;
  return { ...base, ...(colorful && !bg ? colorfulSurfaces : {}), ...(bg ?? {}),
    ...(colorful && !ac ? { ...colorfulAccent, borderFocus: colorfulAccent.primary } : {}),
    ...(ac ? { ...ac, borderFocus: ac.primary } : {}) };
}

// TYPOGRAPHY is a shared constant read when style sheets are built, so the font family is
// applied to it in place and themed styles rebuild on change. Font SIZE is not applied here:
// theme/globalText scales every Text as it renders, which also covers inline and static
// styles, and scaling in both places would double it.
const BASE_TYPOGRAPHY: Record<string, { heading: boolean }> = Object.fromEntries(
  Object.entries(TYPOGRAPHY).map(([key, value]) => [key, { heading: value.fontFamily === FONTS.heading }]),
);
let appliedTypographyKey = 'atlas:normal';

export function applyTypography(appearance?: Appearance): string {
  const font = FONT_CHOICES.find(f => f.id === appearance?.font) ?? FONT_CHOICES[0];
  const size = TEXT_SIZES.find(t => t.id === appearance?.textSize) ?? TEXT_SIZES[1];
  const key = `${font.id}:${size.id}:${appearance?.layoutMode ?? 'standard'}`;
  if (key === appliedTypographyKey) return key;
  appliedTypographyKey = key;
  FONTS.heading = font.heading;
  FONTS.body = font.body;
  FONTS.mono = font.body;
  for (const [name, style] of Object.entries(TYPOGRAPHY) as Array<[string, { fontFamily: string }]>) {
    const base = BASE_TYPOGRAPHY[name];
    if (!base) continue;
    style.fontFamily = base.heading ? font.heading : font.body;
  }
  return key;
}
