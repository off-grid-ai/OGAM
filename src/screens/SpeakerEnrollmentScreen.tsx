/**
 * Voice enrollment — the user reads one sentence a few times so we can learn their voiceprint.
 *
 * Records ENROLLMENT_SAMPLE_COUNT short clips of ENROLLMENT_PROMPT, embeds each through the ACTIVE
 * (swappable) speaker-embedding model, and saves one averaged, model-tagged profile. Brand: Menlo,
 * light weights, 8px radius, emerald only on the active action — mirrors the Day recorder pass.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { TYPOGRAPHY, SPACING } from '../constants';
import { SPEAKER_EMBEDDING_MODELS } from '@offgrid/models';
import { useSpeakerModelStore } from '../stores/speakerModelStore';
import { useSpeakerProfilesStore } from '../stores/speakerProfilesStore';
import { audioRecorderService } from '../services/audioRecorderService';
import { resolveSpeakerEngine } from '../services/ambient/speakerEngineFactory';
import { dispatchSpeakerEmbed } from '../services/ambient/speakerEmbedder';
import {
  enrollSpeaker,
  ENROLLMENT_PROMPT,
  ENROLLMENT_SAMPLE_COUNT,
} from '../services/ambient/speakerEnrollment';

export function SpeakerEnrollmentScreen(): React.ReactElement {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const selectedModelId = useSpeakerModelStore(s => s.selectedModelId);
  const setSelectedModel = useSpeakerModelStore(s => s.setSelectedModel);
  const activeModel = useSpeakerModelStore(s => s.activeModel)();
  const enroll = useSpeakerProfilesStore(s => s.enroll);

  const [name, setName] = useState('');
  const [slices, setSlices] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);

  const done = slices.length >= ENROLLMENT_SAMPLE_COUNT;

  const toggleRecord = useCallback(async () => {
    try {
      if (recording) {
        const { path } = await audioRecorderService.stopRecording();
        setRecording(false);
        if (path) setSlices(prev => [...prev, path]);
      } else {
        await audioRecorderService.startRecording();
        setRecording(true);
      }
    } catch (e) {
      setRecording(false);
      Alert.alert('Recording failed', e instanceof Error ? e.message : 'Could not access the microphone.');
    }
  }, [recording]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const engine = resolveSpeakerEngine();
      const embed = async (slicePath: string) => {
        const r = await dispatchSpeakerEmbed({ slicePath }, { phone: engine.embedder });
        if (!r.ok) throw new Error(r.error);
        return r.embedding;
      };
      const { usableSamples } = await enrollSpeaker(name, slices, { embed, enroll, modelId: engine.modelId });
      Alert.alert('Voice saved', `${name.trim()} enrolled from ${usableSamples} sample${usableSamples === 1 ? '' : 's'}.`);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Could not save voice', e instanceof Error ? e.message : 'Enrollment failed.');
    } finally {
      setSaving(false);
    }
  }, [name, slices, activeModel, enroll, navigation]);

  const progress = useMemo(
    () => Array.from({ length: ENROLLMENT_SAMPLE_COUNT }, (_, i) => i < slices.length),
    [slices.length],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Add a voice" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Name */}
        <Text style={styles.label}>WHO IS THIS?</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Priya"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="words"
          returnKeyType="done"
        />

        {/* Model picker — swappable embedding models */}
        <Text style={[styles.label, styles.spacer]}>VOICE MODEL</Text>
        {SPEAKER_EMBEDDING_MODELS.map(m => {
          const on = m.id === selectedModelId;
          return (
            <TouchableOpacity
              key={m.id}
              style={[styles.modelRow, on && styles.modelRowOn]}
              onPress={() => setSelectedModel(m.id)}
              activeOpacity={0.7}
            >
              <Icon
                name={on ? 'check-circle' : 'circle'}
                size={16}
                color={on ? colors.primary : colors.textMuted}
              />
              <View style={styles.modelText}>
                <Text style={styles.modelName}>
                  {m.name}
                  {m.recommended ? '  ·  recommended' : ''}
                </Text>
                <Text style={styles.modelDesc}>{m.description} · {m.sizeMb} MB</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Prompt to read */}
        <Text style={[styles.label, styles.spacer]}>READ THIS ALOUD</Text>
        <View style={styles.promptCard}>
          <Text style={styles.prompt}>{ENROLLMENT_PROMPT}</Text>
        </View>

        {/* Progress dots */}
        <View style={styles.dots}>
          {progress.map((filled, i) => (
            <View key={i} style={[styles.dot, filled && styles.dotOn]} />
          ))}
          <Text style={styles.dotsLabel}>{slices.length}/{ENROLLMENT_SAMPLE_COUNT} recorded</Text>
        </View>

        {/* Record / Stop */}
        {!done && (
          <TouchableOpacity
            style={[styles.record, recording && styles.recordOn]}
            onPress={toggleRecord}
            activeOpacity={0.8}
          >
            <Icon name={recording ? 'square' : 'mic'} size={18} color={recording ? colors.background : colors.primary} />
            <Text style={[styles.recordText, recording && styles.recordTextOn]}>
              {recording ? 'Stop' : slices.length === 0 ? 'Record' : 'Record again'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Save */}
        {done && (
          <TouchableOpacity
            style={[styles.save, (!name.trim() || saving) && styles.saveDisabled]}
            onPress={save}
            disabled={!name.trim() || saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <>
                <Icon name="check" size={18} color={colors.background} />
                <Text style={styles.saveText}>Save voice</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  const RADIUS = SPACING.sm;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: SPACING.lg, gap: SPACING.sm, paddingBottom: SPACING.xxl },
    label: { ...TYPOGRAPHY.label, color: colors.textMuted, letterSpacing: 1.4, textTransform: 'uppercase' },
    spacer: { marginTop: SPACING.lg },
    input: {
      ...TYPOGRAPHY.body,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: RADIUS,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.md,
      backgroundColor: colors.surface,
    },
    modelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: RADIUS,
      backgroundColor: colors.surface,
    },
    modelRowOn: { borderColor: colors.primary },
    modelText: { flex: 1 },
    modelName: { ...TYPOGRAPHY.bodySmall, color: colors.text },
    modelDesc: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: 2 },
    promptCard: {
      borderWidth: 1,
      borderLeftWidth: 2,
      borderColor: colors.border,
      borderLeftColor: colors.primary,
      borderRadius: RADIUS,
      padding: SPACING.md,
      backgroundColor: colors.surface,
    },
    prompt: { ...TYPOGRAPHY.body, color: colors.text, lineHeight: 22 },
    dots: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.md },
    dot: { width: 10, height: 10, borderRadius: SPACING.xs, borderWidth: 1, borderColor: colors.textMuted },
    dotOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    dotsLabel: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginLeft: SPACING.sm },
    record: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACING.sm,
      marginTop: SPACING.md,
      paddingVertical: SPACING.md,
      borderRadius: RADIUS,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    recordOn: { backgroundColor: colors.error, borderColor: colors.error },
    recordText: { ...TYPOGRAPHY.bodySmall, color: colors.primary },
    recordTextOn: { color: colors.background },
    save: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACING.sm,
      marginTop: SPACING.md,
      paddingVertical: SPACING.md,
      borderRadius: RADIUS,
      backgroundColor: colors.primary,
    },
    saveDisabled: { backgroundColor: colors.surfaceHover },
    saveText: { ...TYPOGRAPHY.bodySmall, color: colors.background },
  });
}
