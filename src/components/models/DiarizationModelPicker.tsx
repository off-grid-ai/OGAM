/**
 * The voice-recognition (diarization) model picker — shared by the Day recorder's "Recorder models"
 * screen and the main Models screen's Recorder tab, so the same list, download, and switch logic lives
 * in one place. Pro-gated: free users see an upsell.
 *
 * Downloading is runtime-aware (sherpa embedding, or the Nemotron ONNX diarizer) via downloadDiarizer.
 * Switching keeps enrolled voices — they re-embed into the new model's space on the next recording.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { DIARIZATION_MODELS, type DiarizationModel } from '@offgrid/models';
import { useVoiceRecognitionUnlocked } from '../../hooks/useVoiceRecognitionUnlocked';
import { useSpeakerModelStore } from '../../stores/speakerModelStore';
import { useSpeakerProfilesStore } from '../../stores/speakerProfilesStore';
import { isEmbeddingBundled } from '../../services/ambient/sherpaModelDownload';
import { isDiarizerReady, downloadDiarizer } from '../../services/ambient/nemotronModelDownload';
import { currentMacOffloadTarget } from '../../services/ambient/macTranscriptionTarget';

/** How enrolled voices fare across a fingerprint switch: those with a saved sample re-embed
 *  automatically; those without (enrolled before samples were kept) need re-recording. */
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

export function DiarizationModelPicker(): React.ReactElement {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const isPro = useVoiceRecognitionUnlocked();
  const macConnected = !!currentMacOffloadTarget();

  const selectedId = useSpeakerModelStore(s => s.diarizationModelId);
  const setSelected = useSpeakerModelStore(s => s.setDiarizationModel);

  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<Record<string, number | undefined>>({});

  useEffect(() => {
    (async () => {
      const r: Record<string, boolean> = {};
      for (const m of DIARIZATION_MODELS) r[m.id] = await isDiarizerReady(m);
      setReady(r);
    })();
  }, []);

  const applySwitch = useCallback(
    async (m: DiarizationModel) => {
      if (ready[m.id]) {
        setSelected(m.id);
        return;
      }
      setProgress(p => ({ ...p, [m.id]: 0 }));
      try {
        await downloadDiarizer(m, f => setProgress(p => ({ ...p, [m.id]: f })));
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
      // Already active AND downloaded → nothing to do. But an already-selected model that isn't
      // downloaded yet must still be gettable (that was the "Get does nothing" bug), so fall through
      // to applySwitch, which downloads it.
      if (m.id === selectedId && ready[m.id]) return;
      const { people, migratable, needRecord } = voiceMigrationInfo();
      if (people === 0 || m.id === selectedId) {
        void applySwitch(m);
        return;
      }
      const carry =
        needRecord === 0
          ? `Your ${people} saved ${people === 1 ? 'voice carries' : 'voices carry'} over to ${m.name} automatically — no re-recording.`
          : `${migratable} of ${people} voices carry over automatically. ${needRecord === 1 ? '1 voice was' : `${needRecord} voices were`} added before voice samples were saved and will need re-recording under Voices.`;
      Alert.alert(`Switch to ${m.name}?`, carry, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch', onPress: () => void applySwitch(m) },
      ]);
    },
    [selectedId, ready, applySwitch],
  );

  if (!isPro) {
    return (
      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('ProDetail')} activeOpacity={0.7}>
        <View style={styles.cardHead}>
          <Icon name="users" size={16} color={colors.primary} />
          <Text style={styles.cardTitle}>Voice recognition</Text>
        </View>
        <Text style={styles.cardWhat}>
          Separate who-spoke-when and recognize each person's voice, so you can see who said what. Part of Pro.
        </Text>
        <View style={styles.linkBtn}>
          <Icon name="lock" size={14} color={colors.primary} />
          <Text style={styles.linkBtnText}>Unlock with Pro</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Icon name="users" size={16} color={colors.primary} />
        <Text style={styles.cardTitle}>Voice recognition</Text>
      </View>
      <Text style={styles.cardWhat}>
        Separates who-spoke-when in a conversation and recognizes each person's voice. Pick a model — the
        default is built in; others download once.
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
  );
}

function createStyles(colors: ThemeColors) {
  const RADIUS = SPACING.sm;
  return StyleSheet.create({
    card: { borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS, backgroundColor: colors.surface, padding: SPACING.md, gap: SPACING.sm },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
    cardTitle: { ...TYPOGRAPHY.body, color: colors.text },
    cardWhat: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, lineHeight: 19 },
    runRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
    runText: { ...TYPOGRAPHY.meta, color: colors.textMuted },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, alignSelf: 'flex-start', marginTop: SPACING.xs },
    linkBtnText: { ...TYPOGRAPHY.bodySmall, color: colors.primary },
    optRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: colors.border },
    optText: { flex: 1 },
    optName: { ...TYPOGRAPHY.bodySmall, color: colors.text },
    optMeta: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: 2 },
    statusWrap: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
    statusText: { ...TYPOGRAPHY.meta },
  });
}
