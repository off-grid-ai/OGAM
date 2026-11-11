import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { Button } from '../components/Button';
import { describeTiming, nextOccurrence, nextTimeOfDay, type Repeat } from './due';
import { useSchedule, type ScheduledTask, type TaskKind } from './store';
import { runTask } from './runner';
import { askForNotifications, alarmsAvailable } from './alarms';

const REPEATS: { id: Repeat; label: string }[] = [
  { id: 'once', label: 'Once' }, { id: 'daily', label: 'Every day' }, { id: 'weekdays', label: 'Weekdays' }, { id: 'weekly', label: 'Weekly' },
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Starting points: tap one, adjust, save. */
const IDEAS: { name: string; kind: TaskKind; prompt: string; repeat: Repeat; hour: number; minute: number; weekday?: number }[] = [
  { name: 'Morning briefing', kind: 'briefing', prompt: '', repeat: 'weekdays', hour: 7, minute: 30 },
  { name: 'Plan my day', kind: 'prompt', prompt: '/daily-planner Make a simple plan for my day. Ask nothing; assume a normal working day and leave room for breaks.', repeat: 'weekdays', hour: 8, minute: 0 },
  { name: 'Weekly review', kind: 'prompt', prompt: 'Give me a short weekly review template: what went well, what did not, and three goals for next week, with a question under each.', repeat: 'weekly', weekday: 0, hour: 18, minute: 0 },
  { name: 'Word of the day', kind: 'prompt', prompt: 'Give me one interesting English word with its meaning, an example sentence and where it comes from.', repeat: 'daily', hour: 9, minute: 0 },
];

const pad = (n: number) => String(n).padStart(2, '0');

type Draft = { id?: string; name: string; kind: TaskKind; prompt: string; repeat: Repeat; hour: number; minute: number; weekday: number };
const blank = (): Draft => ({ name: '', kind: 'prompt', prompt: '', repeat: 'daily', hour: 8, minute: 0, weekday: 1 });

function Chip({ label, on, onPress, testID }: { label: string; on: boolean; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} testID={testID} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={[styles.chip, on ? { borderColor: colors.primary, backgroundColor: colors.surface } : { borderColor: colors.border }]}>
      <Text style={{ color: on ? colors.primary : colors.textSecondary }}>{label}</Text>
    </TouchableOpacity>
  );
}

function Stepper({ label, value, onChange, testID }: { label: string; value: number; onChange: (v: number) => void; testID: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.stepper}>
      <TouchableOpacity onPress={() => onChange(-1)} testID={`${testID}-down`} accessibilityLabel={`${label} down`}><Icon name="minus-circle" size={24} color={colors.primary} /></TouchableOpacity>
      <Text style={[styles.big, { color: colors.text }]} testID={testID}>{pad(value)}</Text>
      <TouchableOpacity onPress={() => onChange(1)} testID={`${testID}-up`} accessibilityLabel={`${label} up`}><Icon name="plus-circle" size={24} color={colors.primary} /></TouchableOpacity>
    </View>
  );
}

/** Tasks the AI runs for you at a time you choose, while Atlas is open: a daily briefing, a plan, anything you can ask. */
export const ScheduleScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { tasks, add, update, remove } = useSchedule();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const save = () => {
    if (!draft) return;
    const fields = {
      name: draft.name.trim() || (draft.kind === 'briefing' ? 'Daily briefing' : 'Scheduled task'),
      kind: draft.kind, prompt: draft.kind === 'briefing' ? '' : draft.prompt.trim(),
      repeat: draft.repeat, hour: draft.hour, minute: draft.minute,
      weekday: draft.repeat === 'weekly' ? draft.weekday : undefined,
      onceAt: draft.repeat === 'once' ? nextTimeOfDay(draft.hour, draft.minute, Date.now()) : undefined,
    };
    if (draft.id) update(draft.id, { ...fields, enabled: true, lastError: undefined });
    else add(fields);
    setDraft(null);
    if (alarmsAvailable()) void askForNotifications();
  };
  const canSave = !!draft && (draft.kind === 'briefing' || !!draft.prompt.trim());
  const runNow = async (t: ScheduledTask) => {
    setBusy(t.id);
    const error = await runTask(t.id);
    setBusy(null);
    if (error) Alert.alert('Could not run it', error);
  };
  const open = (t: ScheduledTask) => {
    if (t.kind === 'briefing') { navigation.navigate('DailyBrief'); return; }
    if (!t.lastChatId) return;
    update(t.id, { resultSeen: true });
    navigation.navigate('Chat', { conversationId: t.lastChatId });
  };
  const confirmDelete = (t: ScheduledTask) => Alert.alert('Delete this task?', t.name, [
    { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => remove(t.id) },
  ]);
  const edit = (t: ScheduledTask) => setDraft({ id: t.id, name: t.name, kind: t.kind, prompt: t.prompt, repeat: t.repeat, hour: t.hour, minute: t.minute, weekday: t.weekday ?? 1 });
  const bump = (field: 'hour' | 'minute', by: number) => setDraft((d) => {
    if (!d) return d;
    return field === 'hour' ? { ...d, hour: (d.hour + by + 24) % 24 } : { ...d, minute: (d.minute + by * 5 + 60) % 60 };
  });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back"><Icon name="arrow-left" size={20} color={colors.text} /></TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Scheduled tasks</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.meta, { color: colors.textMuted }]}>
          At the time you set, Atlas shows a notification; tap it and the task runs. A task also runs by itself whenever Atlas is open at that time. If the phone was away, it runs once when you come back. Each answer is kept as a chat, and a row on Home tells you it is ready.
        </Text>

        {tasks.map((t) => {
          const next = t.enabled ? nextOccurrence(t, Date.now()) : null;
          return (
            <View key={t.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} testID={`task-${t.id}`}>
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Text style={[styles.name, { color: colors.text }]}>{t.name}</Text>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>{t.kind === 'briefing' ? 'Daily briefing' : 'Ask the AI'} · {describeTiming(t)}</Text>
                </View>
                <Switch value={t.enabled} onValueChange={(on) => update(t.id, { enabled: on })} testID={`task-switch-${t.id}`} />
              </View>
              {!!next && <Text style={[styles.meta, { color: colors.textMuted }]}>Next: {new Date(next).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</Text>}
              {!!t.lastRunAt && <Text style={[styles.meta, { color: colors.textMuted }]}>Last ran {new Date(t.lastRunAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</Text>}
              {!!t.lastError && <Text style={[styles.meta, { color: colors.error }]} testID={`task-error-${t.id}`}>Last try failed: {t.lastError}</Text>}
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => runNow(t)} disabled={busy !== null} testID={`task-run-${t.id}`}><Text style={{ color: colors.primary }}>{busy === t.id ? 'Running...' : 'Run now'}</Text></TouchableOpacity>
                {(!!t.lastChatId || t.kind === 'briefing') && <TouchableOpacity onPress={() => open(t)} testID={`task-open-${t.id}`}><Text style={{ color: colors.primary }}>{t.kind === 'briefing' ? 'Open briefing' : 'Open the last answer'}</Text></TouchableOpacity>}
                <TouchableOpacity onPress={() => edit(t)} testID={`task-edit-${t.id}`}><Text style={{ color: colors.primary }}>Edit</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => confirmDelete(t)} testID={`task-delete-${t.id}`}><Text style={{ color: colors.error }}>Delete</Text></TouchableOpacity>
              </View>
            </View>
          );
        })}
        {!tasks.length && !draft && <Text style={[styles.meta, { color: colors.textMuted }]} testID="schedule-empty">Nothing scheduled yet.</Text>}

        {!draft && (
          <>
            <Button title="New task" onPress={() => setDraft(blank())} testID="task-new" />
            <Text style={[styles.meta, { color: colors.textMuted }]}>Or start from an idea:</Text>
            <View style={styles.chips}>
              {IDEAS.map((i) => <Chip key={i.name} label={i.name} on={false} testID={`idea-${i.name.toLowerCase().replace(/\s+/g, '-')}`}
                onPress={() => setDraft({ name: i.name, kind: i.kind, prompt: i.prompt, repeat: i.repeat, hour: i.hour, minute: i.minute, weekday: i.weekday ?? 1 })} />)}
            </View>
          </>
        )}

        {!!draft && (
          <View style={[styles.card, { borderColor: colors.primary, backgroundColor: colors.surface }]} testID="task-form">
            <Text style={[styles.name, { color: colors.text }]}>{draft.id ? 'Edit task' : 'New task'}</Text>
            <TextInput value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} placeholder="Name" placeholderTextColor={colors.textMuted}
              style={[styles.input, { color: colors.text, borderColor: colors.border }]} testID="task-name" />
            <View style={styles.chips}>
              <Chip label="Ask the AI" on={draft.kind === 'prompt'} onPress={() => setDraft({ ...draft, kind: 'prompt' })} testID="task-kind-prompt" />
              <Chip label="Daily briefing" on={draft.kind === 'briefing'} onPress={() => setDraft({ ...draft, kind: 'briefing' })} testID="task-kind-briefing" />
            </View>
            {draft.kind === 'prompt' && (
              <TextInput value={draft.prompt} onChangeText={(prompt) => setDraft({ ...draft, prompt })} multiline testID="task-prompt"
                placeholder={'What should the AI do? Start with /skill-name to use a skill, e.g. "/summarize the top tech news"'} placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.multi, { color: colors.text, borderColor: colors.border }]} />
            )}
            <View style={styles.chips}>
              {REPEATS.map((r) => <Chip key={r.id} label={r.label} on={draft.repeat === r.id} onPress={() => setDraft({ ...draft, repeat: r.id })} testID={`task-repeat-${r.id}`} />)}
            </View>
            {draft.repeat === 'weekly' && (
              <View style={styles.chips}>
                {DAYS.map((d, i) => <Chip key={d} label={d} on={draft.weekday === i} onPress={() => setDraft({ ...draft, weekday: i })} testID={`task-day-${i}`} />)}
              </View>
            )}
            <View style={styles.row}>
              <Stepper label="Hour" value={draft.hour} onChange={(by) => bump('hour', by)} testID="task-hour" />
              <Text style={[styles.big, { color: colors.text }]}>:</Text>
              <Stepper label="Minute" value={draft.minute} onChange={(by) => bump('minute', by)} testID="task-minute" />
            </View>
            <View style={styles.actions}>
              <Button title="Save" onPress={save} disabled={!canSave} testID="task-save" />
              <Button title="Cancel" variant="ghost" onPress={() => setDraft(null)} testID="task-cancel" />
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  title: { fontSize: 22, fontWeight: '400' },
  body: { padding: 16, gap: 12, paddingBottom: 60 },
  meta: { fontSize: 13 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'space-between' },
  flex: { flex: 1 },
  name: { fontSize: 16, fontWeight: '400' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10 },
  multi: { minHeight: 90, textAlignVertical: 'top' },
  big: { fontSize: 22, minWidth: 36, textAlign: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
