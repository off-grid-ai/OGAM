import React, { useEffect, useRef } from 'react';
import { View, Text } from 'react-native';
import { AppSheet } from './AppSheet';
import { useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import { requestStoreReview, type ShareVariant } from '../utils/sharePrompt';
import { useAppStore } from '../stores/appStore';
import {
  ratingPromptDismissed,
  ratingPromptRateTapped,
  ratingPromptShown,
} from '../services/analytics/analytics';
import { Button } from './Button';

interface SharePromptSheetProps {
  visible: boolean;
  onClose: () => void;
  /** What earned the ask: the 2nd successful reply (`text`) or image (`image`). */
  trigger?: ShareVariant;
}

type Outcome = 'rate' | 'never' | 'not_now';

const REVIEW_AFTER_CLOSE_MS = 600;

/**
 * The rating ask, shown once per session after a reply or image worked. Rate opens the store's
 * own review dialog once this sheet has closed, so the two never stack.
 */
export const SharePromptSheet: React.FC<SharePromptSheetProps> = ({ visible, onClose, trigger = 'text' }) => {
  const styles = useThemedStyles(createStyles);
  const setEngaged = useAppStore(s => s.setHasEngagedSharePrompt);
  // How this showing ended. Anything that closes the sheet without a choice (swipe, tap outside,
  // Not now) counts as not_now.
  const outcome = useRef<Outcome>('not_now');

  useEffect(() => {
    if (!visible) return;
    outcome.current = 'not_now';
    ratingPromptShown(trigger);
  }, [visible, trigger]);

  const close = (choice: Outcome) => {
    outcome.current = choice;
    if (choice !== 'not_now') setEngaged(true);
    if (choice !== 'rate') ratingPromptDismissed(trigger, choice);
    onClose();
  };

  // Swipe down or tap outside: the sheet closes itself, so record it here.
  const handleSheetClose = () => {
    if (outcome.current === 'not_now') ratingPromptDismissed(trigger, 'not_now');
    onClose();
  };

  const handleClosed = () => {
    if (outcome.current !== 'rate') return;
    outcome.current = 'not_now';
    // The sheet's native Modal is still being dismissed when this runs. iOS drops a review request
    // made while a presented view controller is going away (seen on device), so wait it out.
    setTimeout(() => {
      requestStoreReview()
        .then(route => ratingPromptRateTapped(trigger, route))
        .catch(() => {});
    }, REVIEW_AFTER_CLOSE_MS);
  };

  return (
    <AppSheet
      sheet="share-prompt"
      visible={visible}
      onClose={handleSheetClose}
      onClosed={handleClosed}
      enableDynamicSizing
      title="Did that just work for you?"
    >
      <View style={styles.content}>
        <Text style={styles.message}>
          A quick rating helps other people find AI that stays on their phone.
        </Text>

        <Button
          title="Rate Off Grid AI"
          variant="primary"
          onPress={() => close('rate')}
          style={styles.rateButton}
          testID="share-prompt-rate"
        />

        <View style={styles.dismissActions}>
          <Button
            title="Not now"
            variant="ghost"
            size="small"
            onPress={() => close('not_now')}
            style={styles.dismissButton}
            textStyle={styles.dismissText}
            testID="share-prompt-maybe-later"
          />
          <Button
            title="Don't ask again"
            variant="ghost"
            size="small"
            onPress={() => close('never')}
            style={styles.dismissButton}
            textStyle={styles.dismissText}
            testID="share-prompt-never-show"
          />
        </View>
      </View>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  content: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl,
    alignItems: 'center' as const,
  },
  message: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: SPACING.lg,
  },
  rateButton: {
    width: '100%' as const,
  },
  dismissActions: {
    flexDirection: 'row' as const,
    gap: SPACING.sm,
    width: '100%' as const,
    marginTop: SPACING.sm,
  },
  dismissButton: {
    flex: 1,
    minHeight: 44,
  },
  dismissText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
  },
});
