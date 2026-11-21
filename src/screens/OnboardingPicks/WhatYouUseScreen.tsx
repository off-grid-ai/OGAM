/**
 * Settings → What you use: the onboarding picks, changed any time. Every group with its features;
 * a tap saves, Home follows at once, and model setup checks what the picks need.
 */
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  onboardingGroups,
  partsFor,
  tierOf,
  togglePartAnywhere,
} from '@offgrid/features';
import { AliveScreen } from '../../components/AliveScreen';
import { Button } from '../../components/Button';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores/appStore';
import type { RootStackParamList } from '../../navigation/types';
import { PICKS_PLATFORM } from '../../services/onboardingPicks';
import { PART_ICONS, PickRow } from './PickRow';
import { createPicksStyles } from './styles';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'WhatYouUse'>;
};

const NONE = { groups: [], parts: [] };

export const WhatYouUseScreen: React.FC<Props> = ({ navigation }) => {
  const styles = useThemedStyles(createPicksStyles);
  const picks = useAppStore(s => s.onboardingPicks) ?? NONE;
  const setPicks = useAppStore(s => s.setOnboardingPicks);
  return (
    <AliveScreen
      style={styles.container}
      edges={['top', 'bottom']}
      testID="what-you-use"
    >
      <ScreenHeader title="What you use" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.description}>
          What you pick leads Home and is checked in model setup. Everything
          else stays one tap away.
        </Text>
        {onboardingGroups(PICKS_PLATFORM).map(g => (
          <View key={g.id} style={styles.group}>
            <Text style={styles.section}>{g.name}</Text>
            {partsFor([g.id], PICKS_PLATFORM).map(p => (
              <PickRow
                key={p.id}
                icon={PART_ICONS[p.id] ?? 'circle'}
                title={p.name}
                line={p.does}
                pro={tierOf(p, PICKS_PLATFORM) === 'pro'}
                on={picks.parts.includes(p.id)}
                onPress={() => {
                  const next = togglePartAnywhere(picks, p.id, PICKS_PLATFORM);
                  // The last one out leaves no picks: Home looks as it always did.
                  setPicks(next.parts.length ? next : null);
                }}
                testID={`what-you-use-${p.id}`}
              />
            ))}
          </View>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title="Set up their models"
          variant="outline"
          onPress={() => navigation.push('AutoSetup')}
          style={styles.footerMain}
          testID="what-you-use-setup"
        />
      </View>
    </AliveScreen>
  );
};
