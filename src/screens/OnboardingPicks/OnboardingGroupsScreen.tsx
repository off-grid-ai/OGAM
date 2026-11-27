/**
 * Onboarding step 1: what do you want to do? Pick any group. The groups come from
 * @offgrid/features; the picks are kept in the app store, so a restart resumes with them.
 */
import React, { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  DEFAULT_PICKS,
  onboardingGroups,
  partsFor,
  tierOf,
  toggleGroupPick,
} from '@offgrid/features';
import { AliveScreen } from '../../components/AliveScreen';
import { Button } from '../../components/Button';
import { useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores/appStore';
import { flowResumed } from '../../services/analytics/analytics';
import type { RootStackParamList } from '../../navigation/types';
import { PICKS_PLATFORM } from '../../services/onboardingPicks';
import { GROUP_ICONS, PickRow } from './PickRow';
import { createPicksStyles } from './styles';
import { finishPicks } from './finish';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'OnboardingGroups'>;
};

/** A group reads as Pro when everything in it on the phone is Pro. */
const groupIsPro = (id: string): boolean => {
  const parts = partsFor([id], PICKS_PLATFORM);
  return (
    parts.length > 0 && parts.every(p => tierOf(p, PICKS_PLATFORM) === 'pro')
  );
};

export const OnboardingGroupsScreen: React.FC<Props> = ({ navigation }) => {
  const styles = useThemedStyles(createPicksStyles);
  const picks = useAppStore(s => s.onboardingPicks) ?? DEFAULT_PICKS;
  const setPicks = useAppStore(s => s.setOnboardingPicks);
  useEffect(() => {
    flowResumed('onboarding', 'groups_shown');
  }, []);
  return (
    <AliveScreen
      style={styles.container}
      edges={['top', 'bottom']}
      testID="onboarding-groups"
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>Off Grid AI · Setup</Text>
        <Text style={styles.title}>What do you want to do?</Text>
        <Text style={styles.description}>
          Pick any. Next you choose the details.
        </Text>
        {onboardingGroups(PICKS_PLATFORM).map(g => (
          <PickRow
            key={g.id}
            icon={GROUP_ICONS[g.id] ?? 'circle'}
            title={g.name}
            line={g.does}
            pro={groupIsPro(g.id)}
            on={picks.groups.includes(g.id)}
            onPress={() =>
              setPicks(toggleGroupPick(picks, g.id, PICKS_PLATFORM))
            }
            testID={`onboarding-group-${g.id}`}
          />
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title="Skip, I'll set it up"
          variant="ghost"
          onPress={() => finishPicks(navigation, null)}
          testID="onboarding-picks-skip"
        />
        <Button
          title="Continue"
          // The screen's one main action: the emerald wash (hero), not the quiet slab.
          variant="hero"
          disabled={picks.groups.length === 0}
          onPress={() => {
            setPicks(picks);
            navigation.push('OnboardingFeatures');
          }}
          style={styles.footerMain}
          testID="onboarding-continue"
        />
      </View>
    </AliveScreen>
  );
};
