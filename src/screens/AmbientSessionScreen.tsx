/**
 * One conversation's detail — opened from a timeline card.
 *
 * The structured summary up top (what you came back for: decisions, action items, people), then the
 * full transcript underneath for when you need the exact words. Reads the one session from the store
 * by id; if it is gone (cleared) it says so rather than crashing. Follow-through (action item -> a
 * task/message via our action tools) hangs off the action rows here in a later phase.
 */

import React, { useCallback } from 'react';
import { ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAmbientTimelineStore } from '../stores/ambientTimelineStore';
import { summaryStatusHint } from '../services/ambient/summarizer';
import type { RootStackParamList } from '../navigation/types';

export function AmbientSessionScreen(): React.ReactElement {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'AmbientSession'>>();
  const sessionId = route.params?.sessionId;
  const session = useAmbientTimelineStore(s => s.sessions.find(item => item.id === sessionId));

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
            spoken.map(segment =>
              flagged.has(segment.id) ? (
                <View key={segment.id} style={styles.flaggedLine} testID="ambient-transcript-line">
                  <Text style={styles.flaggedMark}>▎</Text>
                  <Text style={styles.flaggedText}>{segment.transcript}</Text>
                </View>
              ) : (
                <Text key={segment.id} style={styles.transcriptLine} testID="ambient-transcript-line">
                  {segment.transcript}
                </Text>
              )
            )
          )}
        </Section>
      </ScrollView>
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
    transcriptLine: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
    flaggedLine: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
    flaggedMark: { color: colors.primary, fontSize: 15, lineHeight: 20 },
    flaggedText: { color: colors.text, fontSize: 13, lineHeight: 20, flex: 1, fontWeight: '500' },
    emptyTranscript: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
    missing: { padding: 24 },
    missingText: { color: colors.textMuted, fontSize: 14 }
  });
}
