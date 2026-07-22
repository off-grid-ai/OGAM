export type { ThemeColors, ThemeShadows } from './palettes';
export { useThemedStyles } from './useThemedStyles';
// The theme model + hook live in ./useTheme (not here) so siblings (useThemedStyles) import them
// concretely without cycling through this barrel. The barrel only re-exports.
export { useTheme } from './useTheme';
