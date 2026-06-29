import React from 'react';
import { View, Text } from 'react-native';
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
// recorder screen (start/stop controls + dashboard); it pushes to the full
// recordings archive (LocketRecordings) itself.
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

const MemoryPaywall: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Icon name="mic" size={28} color={colors.primary} />
        </View>
        <Text style={styles.title}>Recorder</Text>
        <Text style={styles.body}>
          Record continuously and transcribe on your phone. The audio and the
          transcript stay on the device - nothing is uploaded.
        </Text>
        <Text style={styles.meta}>
          Tap-to-seek timestamps, resumable transcription, on-device Whisper.
        </Text>
        <View style={styles.cta}>
          <Button title="Unlock with Pro" onPress={() => navigation.navigate('ProDetail')} />
        </View>
      </View>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: SPACING.xl,
    gap: SPACING.lg,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: colors.border,
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
  meta: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    textAlign: 'center' as const,
  },
  cta: {
    marginTop: SPACING.sm,
  },
});
