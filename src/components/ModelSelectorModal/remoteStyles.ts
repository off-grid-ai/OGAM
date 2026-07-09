import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY } from '../../constants';

export const createRemoteStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  // Remote tab styles
  addButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginTop: 16,
    gap: 8,
  },
  addButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.background,
    fontWeight: '600' as const,
  },
  addServerButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 12,
    gap: 8,
  },
  addServerButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
    fontWeight: '600' as const,
  },
  remoteModelsContainer: {
    marginTop: 8,
    marginLeft: 16,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: colors.surfaceLight,
  },
  remoteModelItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 8,
  },
  remoteModelName: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    flex: 1,
  },
  capabilityBadges: {
    flexDirection: 'row' as const,
    gap: 4,
  },
  capabilityBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  moreModelsText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: 4,
  },
  statusText: {
    ...TYPOGRAPHY.bodySmall,
    fontWeight: '500' as const,
  },
  sectionSubTitle: {
    // Vertical spacing lives on the wrapping sectionHeaderRow (which also holds the icon).
    // Duplicating margins here pushed the text down relative to the icon inside the row —
    // the iOS "misplaced header" bug. The row owns the spacing now.
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
  },
  sectionHeaderRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 16,
    marginBottom: 8,
  },
  remoteBadge: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.warning,
  },
  modelItemSelectedRemote: {
    backgroundColor: `${colors.warning}10`,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  modelNameSelectedRemote: {
    color: colors.warning,
  },
  checkmarkRemote: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.warning,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  toolBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: `${colors.warning}20`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  thinkingBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#8B5CF620',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  thinkingBadgeText: {
    ...TYPOGRAPHY.bodySmall,
    fontSize: 10,
    color: '#8B5CF6',
  },
  switchModelRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 4,
  },
  addServerInline: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingVertical: 4,
    paddingLeft: 8,
  },
  addServerInlineText: {
    ...TYPOGRAPHY.body,
    fontSize: 13,
    color: colors.primary,
  },
});
