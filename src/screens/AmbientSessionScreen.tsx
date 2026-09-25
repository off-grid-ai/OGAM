/**
 * One conversation's detail — opened from a timeline card.
 *
 * The structured summary up top (what you came back for: decisions, action items, people), then the
 * full transcript underneath for when you need the exact words. Reads the one session from the store
 * by id; if it is gone (cleared) it says so rather than crashing. Follow-through (action item -> a
 * task/message via our action tools) hangs off the action rows here in a later phase.
 */

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAmbientTimelineStore } from '../stores/ambientTimelineStore';
import { sessionSpeakers } from '../services/ambient/timelineModel';
import { useSpeakerProfilesStore } from '../stores/speakerProfilesStore';
import { applySpeakerCorrection } from '../services/ambient/speakerCorrection';
import { embedSessionSegment, activeEngineModelId } from '../services/ambient/segmentVoiceprint';
import { TYPOGRAPHY, SPACING } from '../constants';
import { summaryStatusHint } from '../services/ambient/summarizer';
import type { RootStackParamList } from '../navigation/types';

export function AmbientSessionScreen(): React.ReactElement {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'AmbientSession'>>();
  const sessionId = route.params?.sessionId;
  const session = useAmbientTimelineStore(s => s.sessions.find(item => item.id === sessionId));
  const relabelSpeaker = useAmbientTimelineStore(s => s.relabelSpeaker);
  const profiles = useSpeakerProfilesStore(s => s.profiles);
  const addSample = useSpeakerProfilesStore(s => s.addSample);
  const enroll = useSpeakerProfilesStore(s => s.enroll);
  // Enrolled voices in the ACTIVE ENGINE's space (what diarization used) — not the catalog default,
  // so a Mac-enrolled voice actually shows up here.
  const enrolled = Object.values(profiles).filter(pr => pr.modelId === activeEngineModelId());

  type AssignTarget = { id: string; speakerId: string | null; startMs: number; endMs: number };
  const [assignSeg, setAssignSeg] = useState<AssignTarget | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const closeSheet = useCallback(() => {
    setAssignSeg(null);
    setAddingNew(false);
    setNewName('');
  }, []);

  // Assign a whole speaker/cluster from the segment's OWN audio — no re-recording. Embeds the slice,
  // folds it into the chosen profile (or enrolls a new one), then relabels every segment of that cluster.
  const applyAssign = useCallback(
    async (answer: { kind: 'existing'; profileId: string; name: string } | { kind: 'new'; name: string } | { kind: 'clear' }) => {
      if (!sessionId || !assignSeg) return;
      setBusy(true);
      try {
        if (answer.kind === 'clear') {
          relabelSpeaker(sessionId, assignSeg.speakerId ?? null, null, null);
          return;
        }
        const rec = session?.recordingPath;
        const captured = rec ? await embedSessionSegment(rec, assignSeg.startMs, assignSeg.endMs) : null;
        const embedding = captured?.embedding ?? null;
        const modelId = captured?.modelId ?? activeEngineModelId();

        let targetId: string;
        let targetName: string;
        if (answer.kind === 'existing') {
          applySpeakerCorrection({ kind: 'existing', profileId: answer.profileId }, { embedding, modelId, addSample, enroll });
          targetId = answer.profileId;
          targetName = answer.name;
        } else {
          const name = answer.name.trim();
          if (!name) return;
          if (embedding) {
            const res = applySpeakerCorrection({ kind: 'new', name }, { embedding, modelId, addSample, enroll });
            targetId = res.profileId;
          } else {
            targetId = `named:${name}`; // audio gone — label only, no voiceprint
          }
          targetName = name;
        }
        relabelSpeaker(sessionId, assignSeg.speakerId ?? null, targetId, targetName);
      } finally {
        setBusy(false);
        closeSheet();
      }
    },
    [sessionId, assignSeg, session, addSample, enroll, relabelSpeaker, closeSheet],
  );

  if (!session) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Conversation" onBack={() => navigation.goBack()} />
        <View style={styles.missing}>
          <Text style={styles.missingText}>This conversation is no longer available.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { summary, segments } = session;
  const spoken = segments.filter(s => s.transcript);
  const flagged = new Set(session.flaggedSegmentIds);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={summary.title} onBack={() => navigation.goBack()} />
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <TouchableOpacity
          style={styles.replayStrip}
          onPress={() => (navigation as any).navigate('AmbientReplay', { sessionId: session.id })}
          testID="ambient-open-replay"
        >
          <Icon name="play" size={16} color={colors.primary} />
          <Text style={styles.replayText}>Replay this conversation</Text>
        </TouchableOpacity>
        <Text style={styles.headline} testID="ambient-detail-headline">
          {summary.headline || summaryStatusHint(session.summaryStatus)}
        </Text>
        {sessionSpeakers(session).length > 0 ? (
          <View style={styles.voicesRow} testID="ambient-voices">
            <Icon name="users" size={14} color={colors.primary} />
            <Text style={styles.voicesText}>{sessionSpeakers(session).join('  ·  ')}</Text>
          </View>
        ) : null}

        {summary.decisions.length > 0 ? (
          <Section title="Decisions" styles={styles}>
            {summary.decisions.map((decision, i) => (
              <Bullet key={i} text={decision} styles={styles} testID="ambient-decision" />
            ))}
          </Section>
        ) : null}

        {summary.actionItems.length > 0 ? (
          <Section title="Action items" styles={styles}>
            {summary.actionItems.map((action, i) => (
              <ActionItem key={i} text={action} styles={styles} colors={colors} />
            ))}
          </Section>
        ) : null}

        {summary.people.length > 0 ? (
          <Section title="People" styles={styles}>
            <Text style={styles.people} testID="ambient-people">
              {summary.people.join(', ')}
            </Text>
          </Section>
        ) : null}

        <Section title={`Transcript · ${spoken.length} segment${spoken.length === 1 ? '' : 's'}`} styles={styles}>
          {spoken.length === 0 ? (
            <Text style={styles.emptyTranscript}>No speech was transcribed in this conversation.</Text>
          ) : (
            spoken.map(segment => {
              const isFlagged = flagged.has(segment.id);
              const label =
                segment.speakerName ??
                (segment.speakerId === null && 'speakerId' in segment ? 'Unknown voice' : 'Tag speaker');
              const known = !!segment.speakerName;
              return (
                <TouchableOpacity
                  key={segment.id}
                  style={styles.segRow}
                  onPress={() => setAssignSeg({ id: segment.id, speakerId: segment.speakerId ?? null, startMs: segment.startMs, endMs: segment.endMs })}
                  activeOpacity={0.7}
                  testID="ambient-transcript-line"
                >
                  <Text style={[styles.speakerLabel, !known && styles.speakerLabelMuted]}>{label}</Text>
                  <Text style={[styles.transcriptLine, isFlagged && styles.flaggedText]}>
                    {isFlagged ? '▎ ' : ''}
                    {segment.transcript}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </Section>
      </ScrollView>
      <Modal visible={assignSeg !== null} transparent animationType="fade" onRequestClose={closeSheet}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={busy ? undefined : closeSheet}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>WHOSE VOICE IS THIS?</Text>
            <Text style={styles.sheetHint}>Uses this conversation's audio — no re-recording. Assigns every line from this speaker.</Text>
            {busy ? (
              <View style={styles.sheetBusy}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.sheetBusyText}>Learning this voice…</Text>
              </View>
            ) : addingNew ? (
              <View style={styles.newRow}>
                <TextInput
                  style={styles.newInput}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Name (e.g. Priya)"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                  autoCapitalize="words"
                  onSubmitEditing={() => applyAssign({ kind: 'new', name: newName })}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  onPress={() => applyAssign({ kind: 'new', name: newName })}
                  disabled={!newName.trim()}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="check" size={20} color={newName.trim() ? colors.primary : colors.textMuted} />
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {enrolled.map(pr => (
                  <TouchableOpacity key={pr.id} style={styles.assignRow} onPress={() => applyAssign({ kind: 'existing', profileId: pr.id, name: pr.name })}>
                    <Icon name="user" size={16} color={colors.primary} />
                    <Text style={styles.assignName}>{pr.name}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.assignRow} onPress={() => setAddingNew(true)}>
                  <Icon name="plus" size={16} color={colors.primary} />
                  <Text style={styles.assignName}>New person…</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.assignRow} onPress={() => applyAssign({ kind: 'clear' })}>
                  <Icon name="x" size={16} color={colors.textMuted} />
                  <Text style={[styles.assignName, { color: colors.textMuted }]}>Clear / unknown</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

function Section({
  title,
  styles,
  children
}: {
  title: string;
  styles: any;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Bullet({
  text,
  styles,
  testID
}: {
  text: string;
  styles: any;
  testID?: string;
}): React.ReactElement {
  return (
    <View style={styles.bulletRow} testID={testID}>
      <Text style={styles.bulletDot}>—</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

/**
 * An action item that leaves the app. Tapping opens the native share sheet, which reaches Reminders,
 * Calendar, Messages, Notes - the follow-through the doc calls the universal gap, done phone-native
 * without the desktop connectors. (One-tap routing to the Mac's MCP action tools is the next step.)
 */
function ActionItem({
  text,
  styles,
  colors
}: {
  text: string;
  styles: any;
  colors: any;
}): React.ReactElement {
  const onShare = useCallback(() => {
    Share.share({ message: text }).catch(() => undefined);
  }, [text]);
  return (
    <TouchableOpacity
      style={styles.actionRow}
      onPress={onShare}
      testID="ambient-action"
      activeOpacity={0.7}
    >
      <Text style={styles.bulletDot}>—</Text>
      <Text style={styles.bulletText}>{text}</Text>
      <Icon name="share" size={14} color={colors.primary} />
    </TouchableOpacity>
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
    container: { flex: 1, backgroundColor: colors.background },
    body: { flex: 1 },
    bodyContent: { padding: 16, gap: 20, paddingBottom: 40 },
    headline: { color: colors.text, fontSize: 15, lineHeight: 22, fontWeight: '600' },
    replayStrip: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface },
    replayText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
    section: { gap: 8 },
    sectionTitle: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase'
    },
    sectionBody: { gap: 6 },
    bulletRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    actionRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    bulletDot: { color: colors.primary, fontSize: 13, lineHeight: 19 },
    bulletText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, flex: 1 },
    people: { color: colors.textSecondary, fontSize: 13 },
    segRow: { gap: 2, paddingVertical: SPACING.xs },
    speakerLabel: { ...TYPOGRAPHY.labelSmall, color: colors.primary, letterSpacing: 1.2, textTransform: 'uppercase' },
    speakerLabelMuted: { color: colors.textMuted },
    transcriptLine: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.surface, borderTopLeftRadius: SPACING.lg, borderTopRightRadius: SPACING.lg, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.xxl, gap: SPACING.xs },
    sheetTitle: { ...TYPOGRAPHY.label, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: SPACING.sm },
    assignRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    assignName: { ...TYPOGRAPHY.body, color: colors.text },
    sheetHint: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginBottom: SPACING.sm },
    sheetBusy: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.lg },
    sheetBusyText: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
    newRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.md },
    newInput: { ...TYPOGRAPHY.body, flex: 1, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.primary, padding: 0 },
    flaggedLine: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
    flaggedMark: { color: colors.primary, fontSize: 15, lineHeight: 20 },
    flaggedText: { color: colors.text, fontSize: 13, lineHeight: 20, flex: 1, fontWeight: '500' },
    emptyTranscript: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
    voicesRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
    voicesText: { color: colors.primary, fontSize: 13, flex: 1 },
    missing: { padding: 24 },
    missingText: { color: colors.textMuted, fontSize: 14 }
  });
}
