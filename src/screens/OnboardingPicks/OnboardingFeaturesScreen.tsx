/**
 * Onboarding step 2: which ones? The features of each picked group, a section per group. Only
 * what is picked gets set up; a Pro pick offers Pro here.
 */
import React, { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  DEFAULT_PICKS,
  onboardingGroups,
  partsFor,
  tierOf,
  togglePartPick,
} from '@offgrid/features';
import { AliveScreen } from '../../components/AliveScreen';
import { Button } from '../../components/Button';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores/appStore';
import { selectHasProAccess } from '../../stores/proAccessSlice';
import { flowResumed } from '../../services/analytics/analytics';
import { useGetPro } from '../../hooks/useGetPro';
import type { RootStackParamList } from '../../navigation/types';
import { PICKS_PLATFORM } from '../../services/onboardingPicks';
import { PART_ICONS, PickRow } from './PickRow';
import { createPicksStyles } from './styles';
import { finishPicks } from './finish';

type Props = {
  navigation: NativeStackNavigationProp<
    RootStackParamList,
    'OnboardingFeatures'
  >;
};

export const OnboardingFeaturesScreen: React.FC<Props> = ({ navigation }) => {
  const styles = useThemedStyles(createPicksStyles);
  const picks = useAppStore(s => s.onboardingPicks) ?? DEFAULT_PICKS;
  const setPicks = useAppStore(s => s.setOnboardingPicks);
  const getPro = useGetPro();
  useEffect(() => {
    flowResumed('onboarding', 'features_shown');
  }, []);
  const groups = onboardingGroups(PICKS_PLATFORM).filter(g =>
    picks.groups.includes(g.id),
  );
  // With Pro already active the picks just work, so the Pro offer is only for people without it.
  const hasPro = useAppStore(selectHasProAccess);
  const proPicked =
    !hasPro &&
    partsFor(picks.groups, PICKS_PLATFORM).some(
      p => picks.parts.includes(p.id) && tierOf(p, PICKS_PLATFORM) === 'pro',
    );
  return (
    <AliveScreen
      style={styles.container}
      edges={['top', 'bottom']}
      testID="onboarding-features"
    >
      <ScreenHeader title="The details" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Which ones?</Text>
        <Text style={styles.description}>
          We only set up what you pick. Add more any time.
        </Text>
        {groups.map(g => (
          <View key={g.id} style={styles.group}>
            <Text style={styles.section}>{g.name}</Text>
            {partsFor([g.id], PICKS_PLATFORM).map(p => (
              <PickRow
                key={p.id}
                icon={PART_ICONS[p.id] ?? 'circle'}
                title={p.name}
                line={p.does}
                note={
                  p.platforms[PICKS_PLATFORM] === 'large'
                    ? 'Needs a phone with lots of memory.'
                    : undefined
                }
                pro={tierOf(p, PICKS_PLATFORM) === 'pro'}
                on={picks.parts.includes(p.id)}
                onPress={() => setPicks(togglePartPick(picks, p.id))}
                testID={`onboarding-part-${p.id}`}
              />
            ))}
          </View>
        ))}
        {proPicked ? (
          <View style={styles.offer} testID="onboarding-pro-offer">
            <Text style={styles.note}>
              Pro features start once you have Pro. Your picks are kept.
            </Text>
            <Button
              title="Get Pro"
              variant="outline"
              onPress={() => getPro('onboarding')}
              testID="onboarding-get-pro"
            />
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title="Skip, I'll set it up"
          variant="ghost"
          onPress={() => finishPicks(navigation, null)}
          testID="onboarding-skip"
        />
        <Button
          title="Show me how it works"
          // The screen's one main action: the emerald wash (hero), not the quiet slab.
          variant="hero"
          disabled={picks.parts.length === 0}
          onPress={() => navigation.push('OnboardingGuide')}
          style={styles.footerMain}
          testID="onboarding-continue"
        />
      </View>
    </AliveScreen>
  );
};
