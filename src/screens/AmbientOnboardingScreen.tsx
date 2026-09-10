/**
 * Ambient recorder — first-run setup.
 *
 * A short paged flow: what it is and the privacy promise, consent, the mic permission, then the two
 * choices that shape how it runs (when it processes, how it listens) and the on-device default. Writes
 * each choice straight to the store so it sticks, and marks setup done at the end.
 *
 * Draft flow - to reconcile with the onboarding Dishit + the lead scoped. Composes with the app's
 * existing model AutoSetup (a transcription + chat model are set up in Models).
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { useAmbientTimelineStore } from '../stores/ambientTimelineStore';
import { audioRecorderService } from '../services/audioRecorderService';
import type { ProcessingMode, CaptureMode } from '../services/ambient/processingModel';

const STEP_COUNT = 7;

export function AmbientOnboardingScreen(): React.ReactElement {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation<any>();

  const processingMode = useAmbientTimelineStore(s => s.processingMode);
  const setProcessingMode = useAmbientTimelineStore(s => s.setProcessingMode);
  const captureMode = useAmbientTimelineStore(s => s.captureMode);
  const setCaptureMode = useAmbientTimelineStore(s => s.setCaptureMode);
  const onDeviceOnly = useAmbientTimelineStore(s => s.onDeviceOnly);
  const setOnDeviceOnly = useAmbientTimelineStore(s => s.setOnDeviceOnly);
  const setOnboardingComplete = useAmbientTimelineStore(s => s.setOnboardingComplete);

  const [step, setStep] = useState(0);
  const [micNote, setMicNote] = useState<string | null>(null);

  const next = useCallback(() => setStep(s => Math.min(STEP_COUNT - 1, s + 1)), []);
  const back = useCallback(() => setStep(s => Math.max(0, s - 1)), []);

  const requestMic = useCallback(async () => {
    const granted = await audioRecorderService.requestPermissions().catch(() => false);
    setMicNote(granted ? null : 'You can enable the microphone later in Settings.');
    next();
  }, [next]);

  const finish = useCallback(() => {
    setOnboardingComplete(true);
    navigation.replace('Main', { screen: 'DayTab' });
  }, [navigation, setOnboardingComplete]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.dots}>
        {Array.from({ length: STEP_COUNT }).map((_, i) => (
          <View key={i} style={[styles.dot, i === step && styles.dotOn]} />
        ))}
      </View>

      <View style={styles.body}>
        {step === 0 ? (
          <Step icon="mic" title="Your day, remembered" styles={styles} colors={colors}>
            A recorder that listens to your day and hands you a journal, your tasks, and the moments that
            mattered. It runs on this device — nothing leaves your phone.
          </Step>
        ) : null}

        {step === 1 ? (
          <Step icon="shield" title="You're in control" styles={styles} colors={colors}>
            Recording is always visible while it runs, and everything is processed on this device. Pause
            or stop any time. Where you are, recording others may need their consent — that part is on you.
          </Step>
        ) : null}

        {step === 2 ? (
          <Step icon="mic" title="Microphone" styles={styles} colors={colors}>
            The recorder needs the microphone to hear conversations. {micNote ?? ''}
          </Step>
        ) : null}

        {step === 3 ? (
          <Choice
            title="When should it work?"
            styles={styles}
            colors={colors}
            options={[
              { id: 'live', label: 'Live', desc: 'Transcribe and summarise the moment you stop. Best plugged in.' },
              { id: 'nightly', label: 'Later', desc: 'Queue recordings and process them together. Easier on battery.' }
            ]}
            value={processingMode}
            onSelect={id => setProcessingMode(id as ProcessingMode)}
          />
        ) : null}

        {step === 4 ? (
          <Choice
            title="How should it listen?"
            styles={styles}
            colors={colors}
            options={[
              { id: 'session', label: 'One tap', desc: 'You start and stop each recording.' },
              { id: 'always-on', label: 'Always-on', desc: 'Listens passively through the day. Beta — heavier on battery.' }
            ]}
            value={captureMode}
            onSelect={id => setCaptureMode(id as CaptureMode)}
          />
        ) : null}

        {step === 5 ? (
          <Step icon="lock" title="Keep it on-device" styles={styles} colors={colors}>
            Capture and transcription always stay on this device. Keep summaries and ask-your-day on-device
            too, even if you pick a remote chat model?
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Keep summaries on-device</Text>
              <Switch
                value={onDeviceOnly}
                onValueChange={setOnDeviceOnly}
                trackColor={{ true: colors.primary, false: colors.border }}
                testID="ambient-onboard-privacy"
              />
            </View>
          </Step>
        ) : null}

        {step === 6 ? (
          <Step icon="check-circle" title="You're set" styles={styles} colors={colors}>
            Record a conversation and it shows up in your Day — journal, tasks, and timeline. Make sure a
            transcription and a chat model are set up in Models for the best results.
          </Step>
        ) : null}
      </View>

      <View style={styles.footer}>
        {step > 0 ? (
          <TouchableOpacity onPress={back} style={styles.back} testID="ambient-onboard-back">
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.back} />
        )}
        {step === 2 ? (
          <TouchableOpacity onPress={requestMic} style={styles.primary} testID="ambient-onboard-mic">
            <Text style={styles.primaryText}>Allow microphone</Text>
          </TouchableOpacity>
        ) : step === STEP_COUNT - 1 ? (
          <TouchableOpacity onPress={finish} style={styles.primary} testID="ambient-onboard-start">
            <Text style={styles.primaryText}>Start</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={next} style={styles.primary} testID="ambient-onboard-next">
            <Text style={styles.primaryText}>{step === 0 ? 'Get started' : 'Next'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

function Step({
  icon,
  title,
  styles,
  colors,
  children
}: {
  icon: string;
  title: string;
  styles: any;
  colors: any;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.step}>
      <View style={styles.stepIcon}>
        <Icon name={icon} size={26} color={colors.primary} />
      </View>
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepBody}>{children}</Text>
    </View>
  );
}

function Choice({
  title,
  options,
  value,
  onSelect,
  styles,
  colors
}: {
  title: string;
  options: { id: string; label: string; desc: string }[];
  value: string;
  onSelect: (id: string) => void;
  styles: any;
  colors: any;
}): React.ReactElement {
  return (
    <View style={styles.step}>
      <Text style={styles.stepTitle}>{title}</Text>
      <View style={styles.choices}>
        {options.map(opt => {
          const on = value === opt.id;
          return (
            <TouchableOpacity
              key={opt.id}
              style={[styles.choice, on && styles.choiceOn]}
              onPress={() => onSelect(opt.id)}
              testID={`ambient-onboard-opt-${opt.id}`}
            >
              <View style={styles.choiceHead}>
                <Text style={[styles.choiceLabel, on && styles.choiceLabelOn]}>{opt.label}</Text>
                {on ? <Icon name="check" size={16} color={colors.primary} /> : null}
              </View>
              <Text style={styles.choiceDesc}>{opt.desc}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function createStyles(colors: {
  background: string;
  text: string;
  textMuted: string;
  textSecondary: string;
  surface: string;
  border: string;
  primary: string;
}) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 22 },
    dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', paddingTop: 12 },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
    dotOn: { backgroundColor: colors.primary, width: 20 },
    body: { flex: 1, justifyContent: 'center' },
    step: { gap: 16 },
    stepIcon: { width: 56, height: 56, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    stepTitle: { color: colors.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
    stepBody: { color: colors.textSecondary, fontSize: 15, lineHeight: 24 },
    toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, backgroundColor: colors.surface },
    toggleLabel: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
    choices: { gap: 12 },
    choice: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 16, backgroundColor: colors.surface },
    choiceOn: { borderColor: colors.primary },
    choiceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    choiceLabel: { color: colors.text, fontSize: 16, fontWeight: '700' },
    choiceLabelOn: { color: colors.primary },
    choiceDesc: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 6 },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, gap: 12 },
    back: { paddingHorizontal: 12, paddingVertical: 12, minWidth: 64 },
    backText: { color: colors.textMuted, fontSize: 14 },
    primary: { flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 15, alignItems: 'center' },
    primaryText: { color: colors.background, fontSize: 15, fontWeight: '700' }
  });
}
