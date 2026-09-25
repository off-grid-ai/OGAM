/**
 * Day Recorder models — understand and manage every model the recorder uses, in one place.
 *
 * Transcription + summary are managed in the main Models screen (we link there). Voice recognition
 * (who-spoke-when + whose-voice) runs on-device via a swappable model bundle: the default ships in the
 * app, alternates download as a single file with progress — the same download-and-swap feel as Models.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { useVoiceRecognitionUnlocked } from '../hooks/useVoiceRecognitionUnlocked';
import type { ThemeColors } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { TYPOGRAPHY, SPACING } from '../constants';
import { DIARIZATION_MODELS, WHISPER_MODELS, type DiarizationModel } from '@offgrid/models';
import { getActiveModels } from '../services/modelServices/modelState';
import { activeLocalModelId } from '../services/modelServices/activeRoute';
import { useSpeakerModelStore } from '../stores/speakerModelStore';
import { useSpeakerProfilesStore } from '../stores/speakerProfilesStore';
import { isEmbeddingReady, isEmbeddingBundled, downloadEmbedding } from '../services/ambient/sherpaModelDownload';
import { currentMacOffloadTarget } from '../services/ambient/macTranscriptionTarget';

export function DayRecorderModelsScreen(): React.ReactElement {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const isPro = useVoiceRecognitionUnlocked();

  const transcriptionName =
    WHISPER_MODELS.find(m => m.id === activeLocalModelId('transcription'))?.name ?? null;
  const summaryName = getActiveModels().text.model?.name ?? null;

  const macConnected = !!currentMacOffloadTarget();

  const selectedId = useSpeakerModelStore(s => s.diarizationModelId);
  const setSelected = useSpeakerModelStore(s => s.setDiarizationModel);

  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<Record<string, number | undefined>>({});

  useEffect(() => {
    (async () => {
      const r: Record<string, boolean> = {};
      for (const m of DIARIZATION_MODELS) r[m.id] = await isEmbeddingReady(m);
      setReady(r);
    })();
  }, []);

  // Do the actual switch: download the model if needed, then make it active. Enrolled voices are
  // re-embedded into the new model's space automatically on the next recording (kept audio samples),
  // so switching does not lose anyone who has a saved sample.
  const applySwitch = useCallback(
    async (m: DiarizationModel) => {
      if (ready[m.id]) {
        setSelected(m.id);
        return;
      }
      setProgress(p => ({ ...p, [m.id]: 0 }));
      try {
        await downloadEmbedding(m, f => setProgress(p => ({ ...p, [m.id]: f })));
        setReady(r => ({ ...r, [m.id]: true }));
        setSelected(m.id);
      } catch (e) {
        Alert.alert('Download failed', e instanceof Error ? e.message : 'Could not download the model.');
      } finally {
        setProgress(p => ({ ...p, [m.id]: undefined }));
      }
    },
    [ready, setSelected],
  );

  const onPick = useCallback(
    (m: DiarizationModel) => {
      if (m.id === selectedId) return; // already the active model
      const { people, migratable, needRecord } = voiceMigrationInfo();
      if (people === 0) {
        void applySwitch(m);
        return;
      }
      const carry =
        needRecord === 0
          ? `Your ${people} saved ${people === 1 ? 'voice carries' : 'voices carry'} over to ${m.name} automatically — no re-recording.`
          : `${migratable} of ${people} voices carry over automatically. ${needRecord === 1 ? '1 voice was' : `${needRecord} voices were`} added before voice samples were saved and will need re-recording under Voices.`;
      Alert.alert(`Switch to ${m.name}?`, carry, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch', onPress: () => void applySwitch(m) }
      ]);
    },
    [selectedId, applySwitch],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Recorder models" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Your Day recorder runs on a few models. Here's what each does — and where to change it.
        </Text>

        {macConnected ? (
          <View style={styles.macBanner}>
            <Icon name="airplay" size={16} color={colors.primary} />
            <Text style={styles.macBannerText}>
              Your Mac is connected, so recordings run on it right now — it does the heavy work. The
              on-device models below are used whenever your Mac isn't around.
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.macHintBanner}
            onPress={() => navigation.navigate('RemoteServers')}
            activeOpacity={0.7}
          >
            <Icon name="airplay" size={16} color={colors.textMuted} />
            <Text style={styles.macBannerText}>
              Want recordings to run on your Mac? Connect it under Remote Servers — syncing your
              devices isn't enough on its own. Until then, the on-device models below do the work.
            </Text>
            <Icon name="chevron-right" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        <LinkCard styles={styles} colors={colors} icon="mic" title="Transcription"
          what="Turns what people say into text. Bigger models are more accurate but slower."
          active={transcriptionName}
          onPress={() => navigation.navigate('Main', { screen: 'ModelsTab', params: { initialTab: 'transcription' } })} />

        <LinkCard styles={styles} colors={colors} icon="file-text" title="Summary"
          what="Reads the transcript and writes your journal, to-dos, and actions — it uses your text model."
          active={summaryName}
          onPress={() => navigation.navigate('Main', { screen: 'ModelsTab', params: { initialTab: 'text' } })} />

        {/* Voice recognition — Pro-gated on-device/offloaded speaker separation + identity */}
        {isPro ? (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Icon name="users" size={16} color={colors.primary} />
            <Text style={styles.cardTitle}>Voice recognition</Text>
          </View>
          <Text style={styles.cardWhat}>
            Separates who-spoke-when in a conversation and recognizes each person's voice. Pick a model —
            the default is built in; others download once.
          </Text>
          <View style={styles.runRow}>
            <Icon name={macConnected ? 'airplay' : 'smartphone'} size={12} color={colors.textMuted} />
            <Text style={styles.runText}>
              {macConnected ? 'Now: running on your Mac' : 'Now: running on this device'}
            </Text>
          </View>
          {DIARIZATION_MODELS.map(m => {
            const on = m.id === selectedId;
            const isReady = ready[m.id];
            const prog = progress[m.id];
            const downloading = prog !== undefined;
            return (
              <TouchableOpacity key={m.id} style={styles.optRow} onPress={() => onPick(m)} disabled={downloading} activeOpacity={0.7}>
                <Icon name={on ? 'check-circle' : 'circle'} size={15} color={on ? colors.primary : colors.textMuted} />
                <View style={styles.optText}>
                  <Text style={styles.optName}>{m.name}{m.recommended ? '  ·  recommended' : ''}</Text>
                  <Text style={styles.optMeta}>{m.description} · {m.sizeMb} MB</Text>
                </View>
                {downloading ? (
                  <View style={styles.statusWrap}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.statusText}>{Math.round((prog ?? 0) * 100)}%</Text>
                  </View>
                ) : isReady ? (
                  <Text style={[styles.statusText, { color: isEmbeddingBundled(m) ? colors.textMuted : colors.primary }]}>
                    {isEmbeddingBundled(m) ? 'Built in' : 'Ready'}
                  </Text>
                ) : (
                  <View style={styles.statusWrap}>
                    <Icon name="download" size={14} color={colors.primary} />
                    <Text style={[styles.statusText, { color: colors.primary }]}>Get</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        ) : (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('ProDetail')} activeOpacity={0.7}>
            <View style={styles.cardHead}>
              <Icon name="users" size={16} color={colors.primary} />
              <Text style={styles.cardTitle}>Voice recognition</Text>
            </View>
            <Text style={styles.cardWhat}>
              Separate who-spoke-when and recognize each person's voice, so you can see who said what.
              Part of Pro.
            </Text>
            <View style={styles.linkBtn}>
              <Icon name="lock" size={14} color={colors.primary} />
              <Text style={styles.linkBtnText}>Unlock with Pro</Text>
            </View>
          </TouchableOpacity>
        )}

        <Text style={styles.footnote}>
          Switching keeps your saved voices — they're re-matched to the new model automatically, on this
          device and on your Mac. Only voices added before samples were saved need re-recording.
          Everything here stays on your device.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/** How enrolled voices will fare across a fingerprint switch: everyone with a saved audio sample is
 *  re-embedded automatically; those without (enrolled before samples were kept) need re-recording. */
function voiceMigrationInfo(): { people: number; migratable: number; needRecord: number } {
  const profiles = Object.values(useSpeakerProfilesStore.getState().profiles);
  const hasClipsByPerson = new Map<string, boolean>();
  for (const p of profiles) {
    const key = p.personId || p.id;
    hasClipsByPerson.set(key, (hasClipsByPerson.get(key) ?? false) || (p.enrollmentClips?.length ?? 0) > 0);
  }
  const people = hasClipsByPerson.size;
  const migratable = [...hasClipsByPerson.values()].filter(Boolean).length;
  return { people, migratable, needRecord: people - migratable };
}

function LinkCard({ styles, colors, icon, title, what, active, onPress }: any): React.ReactElement {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Icon name={icon} size={16} color={colors.primary} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <Text style={styles.cardWhat}>{what}</Text>
      <View style={styles.activeRow}>
        <Text style={styles.activeLabel}>Active</Text>
        <Text style={[styles.activeVal, !active && { color: colors.textMuted }]} numberOfLines={1}>
          {active ?? 'None selected'}
        </Text>
      </View>
      <TouchableOpacity style={styles.linkBtn} onPress={onPress}>
        <Text style={styles.linkBtnText}>Manage in Models</Text>
        <Icon name="arrow-right" size={14} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  const RADIUS = SPACING.sm;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl },
    intro: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, lineHeight: 20 },
    macBanner: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start', padding: SPACING.md, borderWidth: 1, borderColor: colors.primary, borderRadius: SPACING.sm, backgroundColor: colors.surface },
    macHintBanner: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', padding: SPACING.md, borderWidth: 1, borderColor: colors.border, borderRadius: SPACING.sm, backgroundColor: colors.surface },
    macBannerText: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, lineHeight: 19, flex: 1 },
    runRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
    runText: { ...TYPOGRAPHY.meta, color: colors.textMuted },
    card: { borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS, backgroundColor: colors.surface, padding: SPACING.md, gap: SPACING.sm },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
    cardTitle: { ...TYPOGRAPHY.body, color: colors.text },
    cardWhat: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, lineHeight: 19 },
    activeRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingTop: SPACING.xs },
    activeLabel: { ...TYPOGRAPHY.label, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
    activeVal: { ...TYPOGRAPHY.bodySmall, color: colors.text, flex: 1, textAlign: 'right' },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, alignSelf: 'flex-start', marginTop: SPACING.xs },
    linkBtnText: { ...TYPOGRAPHY.bodySmall, color: colors.primary },
    optRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: colors.border },
    optText: { flex: 1 },
    optName: { ...TYPOGRAPHY.bodySmall, color: colors.text },
    optMeta: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: 2 },
    statusWrap: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
    statusText: { ...TYPOGRAPHY.meta },
    footnote: { ...TYPOGRAPHY.meta, color: colors.textMuted, lineHeight: 16, marginTop: SPACING.xs },
  });
}
