/**
 * Reflect — the week's horizon for the ambient recorder.
 *
 * A step back from the day: how much you talked each day, how many commitments you kept, and who came
 * up most. All aggregation is pure (reflectWeek); this renders it. Terminal/brutalist, Menlo, emerald.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useThemedStyles } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAmbientTimelineStore } from '../stores/ambientTimelineStore';
import { reflectWeek } from '../services/ambient/reflectModel';

function dateParts(epochMs: number): { y: number; m: number; d: number } {
  const date = new Date(epochMs);
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}
/** The last 7 day keys ending today, oldest first, plus their single-letter labels. */
function lastSevenDays(): { key: string; label: string }[] {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const letters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const out: { key: string; label: string }[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push({
      key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      label: letters[d.getDay()]
    });
  }
  return out;
}
function hoursLabel(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function AmbientReflectScreen(): React.ReactElement {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation();
  const sessions = useAmbientTimelineStore(s => s.sessions);
  const doneTaskIds = useAmbientTimelineStore(s => s.doneTaskIds);

  const week = useMemo(() => lastSevenDays(), []);
  const reflection = useMemo(
    () => reflectWeek(sessions, new Set(doneTaskIds), week.map(d => d.key), dateParts),
    [sessions, doneTaskIds, week]
  );
  const maxCount = Math.max(1, ...reflection.bars.map(b => b.count));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Reflect" onBack={() => navigation.goBack()} />
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {reflection.conversationCount === 0 ? (
          <View style={styles.empty} testID="ambient-reflect-empty">
            <Text style={styles.emptyTitle}>Nothing this week yet</Text>
            <Text style={styles.emptyBody}>Record a few conversations and your week takes shape here.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.eyebrow}>Conversations · this week</Text>
            <View style={styles.bars} testID="ambient-reflect-bars">
              {reflection.bars.map((bar, i) => (
                <View key={bar.dayKey} style={styles.barCol}>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.bar,
                        { height: `${Math.round((bar.count / maxCount) * 100)}%` }
                      ]}
                    />
                  </View>
                  <Text style={styles.barLabel}>{week[i].label}</Text>
                </View>
              ))}
            </View>

            <View style={styles.stats}>
              <Stat styles={styles} value={`${reflection.tasksKept}/${reflection.tasksTotal}`} cap="commitments kept" />
              <Stat styles={styles} value={hoursLabel(reflection.totalSpeechMs)} cap="heard" />
              <Stat styles={styles} value={`${reflection.conversationCount}`} cap="conversations" />
            </View>

            {reflection.topPeople.length > 0 ? (
              <>
                <Text style={styles.eyebrow}>Who came up most</Text>
                <View style={styles.people}>
                  {reflection.topPeople.map(person => (
                    <View key={person.name} style={styles.personRow} testID="ambient-reflect-person">
                      <Text style={styles.personName}>{person.name}</Text>
                      <Text style={styles.personCount}>
                        {person.count} conversation{person.count === 1 ? '' : 's'}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
            <View style={{ height: 24 }} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({
  styles,
  value,
  cap
}: {
  styles: any;
  value: string;
  cap: string;
}): React.ReactElement {
  return (
    <View style={styles.stat}>
      <Text style={styles.statNum}>{value}</Text>
      <Text style={styles.statCap}>{cap}</Text>
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
    container: { flex: 1, backgroundColor: colors.background },
    body: { flex: 1 },
    bodyContent: { padding: 18 },
    empty: { paddingTop: 40, gap: 8 },
    emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
    emptyBody: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
    eyebrow: { color: colors.textMuted, fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: '700', marginBottom: 12, marginTop: 8 },
    bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 120, marginBottom: 22 },
    barCol: { flex: 1, alignItems: 'center', gap: 7 },
    barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
    bar: { width: '100%', backgroundColor: 'rgba(52,211,153,0.16)', borderTopWidth: 2, borderTopColor: colors.primary, borderTopLeftRadius: 2, borderTopRightRadius: 2, minHeight: 3 },
    barLabel: { color: colors.textMuted, fontSize: 10 },
    stats: { flexDirection: 'row', gap: 10, marginBottom: 24 },
    stat: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 13, backgroundColor: colors.surface },
    statNum: { color: colors.primary, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
    statCap: { color: colors.textMuted, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 4 },
    people: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, overflow: 'hidden' },
    personRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    personName: { color: colors.text, fontSize: 14, fontWeight: '600' },
    personCount: { color: colors.textMuted, fontSize: 12 }
  });
}
