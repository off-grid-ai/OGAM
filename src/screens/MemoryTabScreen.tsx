import React from 'react';
import { View, Text, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { useThemedStyles, useTheme } from '../theme';
import type { ThemeColors } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { Button } from '../components';
import { useRegisteredScreens } from '../navigation/screenRegistry';
import type { RootStackParamList } from '../navigation/types';

// Name the recorder registers itself under in pro.activate (screenRegistry).
// Present only when Pro is active; absent in the free build. This is the main
// recorder screen (start/stop controls + dashboard); it handles its own
// in-feature navigation.
const RECORDER_SCREEN = 'AlwaysOnTranscription';

/**
 * The Memory bottom tab. Renders the Pro recorder when it has been registered
 * (pro.activate runs only behind the entitlement gate), otherwise a paywall.
 * The lookup is reactive (useRegisteredScreens), so unlocking Pro at runtime
 * swaps the paywall for the recorder with no app restart. The recorder screen
 * uses useNavigation internally, so it works rendered as a tab root.
 */
export const MemoryTabScreen: React.FC = () => {
  const recorder = useRegisteredScreens().find((s) => s.name === RECORDER_SCREEN);
  if (recorder) {
    const Recorder = recorder.component;
    return <Recorder />;
  }
  return <MemoryPaywall />;
};

interface Feature {
  icon: string;
  title: string;
  desc: string;
}

const FEATURES: Feature[] = [
  {
    icon: 'mic',
    title: `Always-on recording${Platform.OS === 'android' ? '' : ' (Android)'}`,
    desc: 'Capture meetings and conversations in the background, all day.',
  },
  {
    icon: 'file-text',
    title: 'On-device transcription',
    desc: 'Whisper turns recordings into readable text right on your phone.',
  },
  {
    icon: 'align-left',
    title: 'Summaries',
    desc: 'Condense a long recording into the key points and action items.',
  },
  {
    icon: 'calendar',
    title: 'Calendar context',
    desc: 'Each recording is labelled with the meeting and the people in it.',
  },
];

const FeatureRow: React.FC<{ feature: Feature; styles: ReturnType<typeof createStyles>; colors: ThemeColors }> = ({ feature, styles, colors }) => (
  <View style={styles.featureRow}>
    <View style={styles.featureIcon}>
      <Icon name={feature.icon} size={18} color={colors.primary} />
    </View>
    <View style={styles.featureText}>
      <Text style={styles.featureTitle}>{feature.title}</Text>
      <Text style={styles.featureDesc}>{feature.desc}</Text>
    </View>
  </View>
);

const MemoryPaywall: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.iconCircle}>
          <Icon name="mic" size={28} color={colors.primary} />
        </View>
        <Text style={styles.title}>Recorder</Text>
        <Text style={styles.body}>
          Capture your meetings and conversations, then transcribe, summarise, and
          search them - entirely on your phone.
        </Text>

        <View style={styles.features}>
          {FEATURES.map((f) => (
            <FeatureRow key={f.title} feature={f} styles={styles} colors={colors} />
          ))}
        </View>

        <View style={styles.privacyRow}>
          <Icon name="lock" size={13} color={colors.textMuted} />
          <Text style={styles.privacyText}>
            The audio and transcript run in your phone and never leave the device.
          </Text>
        </View>

        <View style={styles.cta}>
          <Button title="Unlock with Pro" onPress={() => navigation.navigate('ProDetail')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xxl,
    gap: SPACING.lg,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${colors.primary}18`,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  title: {
    ...TYPOGRAPHY.h1,
    color: colors.text,
  },
  body: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
  },
  features: {
    width: '100%' as const,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: SPACING.lg,
    gap: SPACING.lg,
    marginTop: SPACING.sm,
  },
  featureRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.md,
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: `${colors.primary}18`,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  featureText: {
    flex: 1,
    gap: 2,
  },
  featureTitle: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  featureDesc: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  privacyRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    paddingHorizontal: SPACING.sm,
  },
  privacyText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    flex: 1,
  },
  cta: {
    width: '100%' as const,
    marginTop: SPACING.sm,
  },
});
