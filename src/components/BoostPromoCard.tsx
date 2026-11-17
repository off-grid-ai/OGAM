import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { BOOST_PROMO, boostPromoCopy, boostPromoLink, boostPromoVisible, type BoostPromoSurface } from '@offgrid/models';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { cardSurface } from '../theme/surface';
import { SPACING, TYPOGRAPHY } from '../constants';
import { useAppStore } from '../stores';
import { AnimatedPressable } from './AnimatedPressable';
import { Button } from './Button';
import { boostPromo } from '../services/analytics/analytics';
import { OfflineError, openWebSheet } from '../services/proCheckout';

const COPY = boostPromoCopy('phone');

/**
 * Models too big for this phone, on our private servers. Free and Pro both see it. Closing it keeps
 * it closed until the promo's version changes. The button opens the offer page in a sheet: the
 * website owns the price.
 */
export const BoostPromoCard: React.FC<{ surface: BoostPromoSurface }> = ({ surface }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const closedVersion = useAppStore(s => s.boostPromoClosedVersion);
  const closeBoostPromo = useAppStore(s => s.closeBoostPromo);
  const visible = boostPromoVisible(closedVersion);
  const [opening, setOpening] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (visible) boostPromo('shown', surface);
  }, [visible, surface]);

  if (!visible) return null;

  const claim = (): void => {
    boostPromo('clicked', surface);
    setOpening(true);
    openWebSheet(boostPromoLink('mobile', surface))
      .then(() => setOffline(false))
      .catch((e: unknown) => setOffline(e instanceof OfflineError))
      .finally(() => setOpening(false));
  };
  const close = (): void => {
    boostPromo('dismissed', surface);
    closeBoostPromo(BOOST_PROMO.version);
  };

  return (
    <View style={styles.card} testID="boost-promo">
      <View style={styles.head}>
        <Text style={styles.title}>{COPY.title}</Text>
        <AnimatedPressable
          onPress={close}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel={COPY.close}
          testID="boost-promo-close"
        >
          <Icon name="x" size={16} color={colors.textMuted} />
        </AnimatedPressable>
      </View>
      <Text style={styles.body}>{COPY.body}</Text>
      <View style={styles.action}>
        <Button title={COPY.action} onPress={claim} loading={opening} testID="boost-promo-claim" />
      </View>
      {offline ? (
        <Text style={styles.offline} testID="boost-promo-offline">
          You're offline. Connect to the internet to see the offer.
        </Text>
      ) : null}
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  card: { ...cardSurface(colors), padding: SPACING.lg, gap: SPACING.sm, marginBottom: SPACING.lg },
  head: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: SPACING.sm },
  title: { ...TYPOGRAPHY.h3, color: colors.text, flex: 1 },
  body: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  action: { flexDirection: 'row' as const, marginTop: SPACING.xs },
  offline: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
});
