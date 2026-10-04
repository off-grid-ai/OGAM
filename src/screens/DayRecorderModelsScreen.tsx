/**
 * Day Recorder models — understand and manage every model the recorder uses, in one place.
 *
 * Transcription + summary are managed in the main Models screen (we link there). Voice recognition
 * (who-spoke-when + whose-voice) runs on-device via a swappable model bundle: the default ships in the
 * app, alternates download as a single file with progress — the same download-and-swap feel as Models.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { TYPOGRAPHY, SPACING } from '../constants';
import { WHISPER_MODELS } from '@offgrid/models';
import { getActiveModels } from '../services/modelServices/modelState';
import { activeLocalModelId } from '../services/modelServices/activeRoute';
import { currentMacOffloadTarget } from '../services/ambient/macTranscriptionTarget';
import { useSpeakerModelStore } from '../stores/speakerModelStore';

export function DayRecorderModelsScreen(): React.ReactElement {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const transcriptionName =
    WHISPER_MODELS.find(m => m.id === activeLocalModelId('transcription'))?.name ?? null;
  const summaryName = getActiveModels().text.model?.name ?? null;
  const voiceName = useSpeakerModelStore(s => s.activeDiarizationModel)().name;

  const macConnected = !!currentMacOffloadTarget();

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

        <LinkCard styles={styles} colors={colors} icon="users" title="Voice recognition"
          what="Separates who-spoke-when in a conversation and recognizes each person's voice. Pick or download a model in Models."
          active={voiceName}
          onPress={() => navigation.navigate('Main', { screen: 'ModelsTab', params: { initialTab: 'recorder' } })} />

        <Text style={styles.footnote}>
          Switching keeps your saved voices — they're re-matched to the new model automatically, on this
          device and on your Mac. Only voices added before samples were saved need re-recording.
          Everything here stays on your device.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
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
