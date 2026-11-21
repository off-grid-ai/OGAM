/**
 * Why Pro is not on here, and the way back: the shared licence-state line (licenceLine in
 * @offgrid/features, the same one the desktop and the extension draw). This passes the facts the
 * phone holds and draws the line with its buttons; it shows nothing when Pro is on or was never here.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { t } from '@offgrid/i18n';
import { LICENCE_ACTION_LABEL, licenceLine, type LicenceAction } from '@offgrid/features';
import { Button } from './Button';
import { useAppStore } from '../stores';
import { selectHasProAccess } from '../stores/proAccessSlice';
import { useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';

interface Props {
  /** What each way back does on this screen. An action with no handler is not offered. */
  onAction: Partial<Record<LicenceAction, () => void>>;
}

export const LicenceNotice: React.FC<Props> = ({ onAction }) => {
  const styles = useThemedStyles(createStyles);
  const hasAccess = useAppStore(selectHasProAccess);
  const expired = useAppStore(s => s.hasExpiredProCredential);
  const removedBy = useAppStore(s => s.licenceRemovedBy);
  const hadLicence = useAppStore(s => s.hasSavedProCredential);
  const line = licenceLine({ hasAccess, expired, removedBy, hadLicence });
  if (!line) return null;
  const actions = line.actions.filter(action => onAction[action]);

  return (
    <View style={styles.card} testID={`licence-notice-${line.kind}`}>
      <Text style={styles.text}>{t(line.text)}</Text>
      <View style={styles.actions}>
        {actions.map((action, index) => (
          <Button
            key={action}
            title={t(LICENCE_ACTION_LABEL[action])}
            variant={index === 0 ? 'hero' : 'secondary'}
            size="small"
            onPress={() => onAction[action]?.()}
            testID={`licence-notice-${action}`}
          />
        ))}
      </View>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  card: {
    marginHorizontal: SPACING.xl,
    marginBottom: SPACING.xl,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    gap: SPACING.md,
  },
  text: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  actions: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: SPACING.sm,
  },
});
