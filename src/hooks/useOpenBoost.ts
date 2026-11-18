/**
 * Opens the Boost offer in the in-app web sheet, counted against the surface that opened it.
 * Offline, the caller says so where it was tapped; any other failure lands on Models, where the
 * offer also lives.
 */
import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { boostPromoLink, type BoostPromoSurface } from '@offgrid/models';
import { boostPromo } from '../services/analytics/analytics';
import { OfflineError, openWebSheet } from '../services/proCheckout';

export function useOpenBoost(surface: BoostPromoSurface, onOffline: () => void): () => void {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return useCallback(() => {
    boostPromo('clicked', surface);
    openWebSheet(boostPromoLink('mobile', surface)).catch((e: unknown) => {
      if (e instanceof OfflineError) onOffline();
      else navigation.navigate('Main', { screen: 'ModelsTab' });
    });
  }, [surface, onOffline, navigation]);
}
