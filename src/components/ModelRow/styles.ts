import { StyleSheet } from 'react-native';
import { TYPOGRAPHY } from '../../constants';
import type { ThemeColors } from '../../theme';

/**
 * Canonical local-model row — one design shared by every model picker (chat + home) so
 * the sheets can't drift into differential looks. Lifted verbatim from the chat
 * selector's card (the design agreed as canonical); the home sheet adopts it via the
 * shared ModelRow component. Any restyle happens here once.
 */
export const createModelRowStyles = (colors: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  rowSelectedText: {
    backgroundColor: `${colors.primary}15`,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  rowSelectedImage: {
    backgroundColor: `${colors.info}15`,
    borderWidth: 1,
    borderColor: colors.info,
  },
  info: { flex: 1 },
  name: { ...TYPOGRAPHY.body, color: colors.text, marginBottom: 4 },
  nameSelectedText: { color: colors.primary },
  nameSelectedImage: { color: colors.info },
  meta: { flexDirection: 'row' as const, alignItems: 'center' as const },
  metaText: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  metaMuted: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
  separator: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, marginHorizontal: 6 },
  visionBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: `${colors.info}20`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  visionBadgeText: { ...TYPOGRAPHY.label, color: colors.info },
  ramHint: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, marginTop: 4 },
  checkmark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  checkmarkText: { backgroundColor: colors.primary },
  checkmarkImage: { backgroundColor: colors.info },
});
