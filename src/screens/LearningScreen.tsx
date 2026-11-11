import React, { useEffect, useState } from 'react';
import { StyleSheet, Alert, Share, Switch, View, Text, TextInput, TouchableOpacity, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useAgentStore } from '../stores/agentStore';
import { NO_AGENT, isNoAgent, setLessons, expertName } from '../learning/agents';
import { reportsMarkdown, writeReportsFile } from '../learning/lessonsFile';
import { markSources, superscript } from '../study/replySources';
import { useProjectStore, useAppStore } from '../stores';
import { useLearningStore, LearnEvent, defaultLearnConfig, newItem, BankStatus } from '../learning/store';
import { projectForSubject, pickAndAddFiles, addWorkspaceFolder, summarize } from '../learning/documents';
import { startLearning, stopLearning, isLearning, onLearningStatus, auditNow, keepSession, newRound } from '../learning/engine';
import { keepScreenOn } from '../atlasVoice/tts';
import { ModelChips } from '../components/ModelChips';
const literalStyles = StyleSheet.create({
  s1: { marginTop: 0 },
  s2: { fontWeight: '700' },
  s3: { marginTop: 6 },
  s4: { marginTop: 8, alignSelf: 'flex-start' },
});


const KIND_ICON: Record<string, string> = {
  bank: 'list', appeal: 'message-square', question: 'help-circle', report: 'edit-3', judge: 'check-square', manager: 'briefcase', info: 'info', error: 'alert-triangle',
};

function Stepper({ label, value, onChange, colors, styles }: any) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepLabel}>{label}</Text>
      <View style={styles.stepRow}>
        <TouchableOpacity onPress={() => onChange(Math.max(1, value - 1))} style={styles.stepBtn}><Icon name="minus" size={16} color={colors.text} /></TouchableOpacity>
        <Text style={styles.stepValue}>{value}</Text>
        <TouchableOpacity onPress={() => onChange(Math.min(20, value + 1))} style={styles.stepBtn}><Icon name="plus" size={16} color={colors.text} /></TouchableOpacity>
      </View>
    </View>
  );
}

/** Learning mode for one agent: learner -> judge -> manager loop, all on the phone. */
export const LearningScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const wide = width >= 900; // tablets / unfolded screens: settings and feed side by side

  const agents = useAgentStore((s) => s.agents);
  // Each subject (an expert) learns on its own. General is always there; others are added below.
  const experts = useLearningStore((s) => s.experts);
  const addExpert = useLearningStore((s) => s.addExpert);
  const removeExpert = useLearningStore((s) => s.removeExpert);
  const [agentId, setAgentId] = useState<string>(route.params?.agentId || NO_AGENT);
  const [newExpert, setNewExpert] = useState('');
  const agent = agents.find((a) => a.id === agentId);
  const projects = useProjectStore((s) => s.projects);
  const rawCfg = useLearningStore((s) => s.config[agentId]);
  const cfg = Object.assign(defaultLearnConfig(), rawCfg || {});
  const setConfig = useLearningStore((s) => s.setConfig);
  const st = useLearningStore((s) => s.state[agentId]);
  const events = useLearningStore((s) => s.events).filter((e) => e.agentId === agentId).slice(0, 80);
  const clearAgent = useLearningStore((s) => s.clearAgent);
  const [running, setRunning] = useState(isLearning());
  const [statusText, setStatusText] = useState(isLearning() ? 'Running' : 'Idle');
  const [open, setOpen] = useState<string | null>(null);
  const [newQ, setNewQ] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const showLessons = useAppStore((s) => s.settings.showLessonsUsed !== false);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [openReport, setOpenReport] = useState<string | null>(null);
  const updateItem = useLearningStore((s) => s.updateItem);
  const addItems = useLearningStore((s) => s.addItems);
  const bank = st?.bank || [];
  const count = (k: BankStatus) => bank.filter((b) => b.status === k).length;
  const STATUS_COLOR: Record<string, string> = { pending: colors.textMuted, approved: colors.primary, answered: '#4D7C0F', rejected: colors.error, failed: '#B45309', dropped: colors.textMuted };
  // A tap on a question only opens it; approving, rejecting and removing are separate, labelled buttons.
  const [openQ, setOpenQ] = useState<string | null>(null);
  const decide = (id: string, status: 'approved' | 'rejected' | 'dropped') => {
    if (status === 'approved') updateItem(agentId, id, { status, reason: undefined, tries: 0 });
    else updateItem(agentId, id, { status, reason: status === 'dropped' ? 'Removed by you' : 'Rejected by you' });
    setOpenQ(null);
  };
  // Documents the learner reads from: picked files, or the Atlas folder. They go into a project named after the subject.
  const [docStatus, setDocStatus] = useState('');
  const addDocuments = async (from: 'files' | 'folder') => {
    const projectId = cfg.projectId || projectForSubject(expertName(agentId));
    if (!cfg.projectId) setConfig(agentId, { projectId });
    setDocStatus('Starting...');
    try {
      if (from === 'files') {
        const r = await pickAndAddFiles(projectId, setDocStatus);
        if (r) Alert.alert('Documents', summarize(r));
      } else {
        const { dir, result } = await addWorkspaceFolder(projectId, setDocStatus);
        Alert.alert('Documents', `${summarize(result)}\n\nFolder read: ${dir}`);
      }
    } catch (e: any) { Alert.alert('Could not add documents', String(e?.message || e)); }
    setDocStatus('');
  };

  useEffect(() => {
    onLearningStatus((s) => { setStatusText(s); setRunning(isLearning()); });
    const t = setInterval(() => setRunning(isLearning()), 1000);
    return () => { onLearningStatus(null); clearInterval(t); };
  }, []);
  useEffect(() => { keepScreenOn(running); return () => keepScreenOn(false); }, [running]);

  const shareReports = async () => {
    const reports = st?.reportLog ?? [];
    const name = expertName(agentId);
    const path = await writeReportsFile(name, reports);
    try { await Share.share({ title: `Reports on ${name}`, message: reportsMarkdown(name, reports) }); } catch { /* closed */ }
    if (path) Alert.alert('Saved as a file too', path);
  };
  const start = () => { setRunning(true); setStatusText('Starting...'); startLearning(agentId).catch((e) => setStatusText(String(e?.message || e))).finally(() => setRunning(false)); };

  const settings = (
    <View>
      <TouchableOpacity onPress={() => navigation.navigate('Knowledge')} style={styles.textbookCard} testID="open-textbook" accessibilityRole="button">
        <Icon name="book-open" size={20} color={colors.primary} />
        <View style={styles.grow}>
          <Text style={styles.chipText}>Studying a textbook or a long PDF?</Text>
          <Text style={styles.counts}>Add it under Knowledge. It is split into sections and studied piece by piece, with every finding tied to a quote and a page.</Text>
        </View>
        <Icon name="chevron-right" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <Text style={styles.label}>Expert</Text>
      <Text style={styles.note}>Each subject learns on its own, so one expert never blurs into another. A chat uses the lessons of the expert whose subject it is about.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.expertRow}>
        {[{ id: NO_AGENT, name: 'General' }, ...experts].map((e) => (
          <TouchableOpacity key={e.id} disabled={running} onPress={() => setAgentId(e.id)} testID={`expert-${e.id}`} accessibilityRole="button"
            accessibilityState={{ selected: e.id === agentId }} style={[styles.chip, e.id === agentId && styles.chipOn]}>
            <Text style={[styles.chipText, e.id === agentId && styles.chipTextOn]}>{e.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {experts.length === 0 && <Text style={styles.counts} testID="no-experts-hint">No experts yet. Type a subject below (Taxes, Law, Psychology) and press Add expert, so the AI learns one field at a time.</Text>}
      <View style={styles.row}>
        <TextInput style={[styles.input, styles.grow]} value={newExpert} onChangeText={setNewExpert} placeholder="New expert, e.g. Taxes, Law, Psychology" placeholderTextColor={colors.textMuted} editable={!running} testID="new-expert-input" />
        <TouchableOpacity disabled={running || !newExpert.trim()} onPress={() => { setAgentId(addExpert(newExpert)); setNewExpert(''); }} style={styles.smallBtn} testID="new-expert-add" accessibilityRole="button">
          <Text style={styles.smallBtnText}>Add expert</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.note}>{agentId === NO_AGENT ? 'General is for anything that is not one field.' : `${expertName(agentId)}: `}Describe something to get good at. The AI researches it, writes reports, a judge checks them, and what it learns is kept as lessons for this subject.</Text>
      <Text style={styles.label}>Task to become an expert at</Text>
      <TextInput
        style={styles.input}
        value={cfg.topic}
        editable={!running}
        onChangeText={(t) => setConfig(agentId, { topic: t })}
        placeholder={'e.g. Treat wound infections without a hospital, and know when antibiotics are needed'}
        placeholderTextColor={colors.textMuted}
        multiline
      />

      <Text style={styles.label}>Knowledge base (project)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {[{ id: '', name: 'None' }, ...projects].map((p) => (
          <TouchableOpacity key={p.id || 'none'} disabled={running} onPress={() => setConfig(agentId, { projectId: p.id })} style={[styles.chip, cfg.projectId === p.id && styles.chipOn]}>
            <Text style={[styles.chipText, cfg.projectId === p.id && styles.chipTextOn]}>{p.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={styles.note}>The learner reads these documents first and cites them. Add your own: pick files, or put them in the Atlas folder on the phone and add the whole folder. They are added to the chosen project (one named after this subject is made if you chose none).</Text>
      <View style={styles.row}>
        <TouchableOpacity disabled={running || !!docStatus} onPress={() => addDocuments('files')} style={styles.smallBtn} testID="learn-add-files" accessibilityRole="button">
          <Text style={styles.smallBtnText}>Add files</Text>
        </TouchableOpacity>
        <TouchableOpacity disabled={running || !!docStatus} onPress={() => addDocuments('folder')} style={styles.smallBtn} testID="learn-add-folder" accessibilityRole="button">
          <Text style={styles.smallBtnText}>Add the Atlas folder</Text>
        </TouchableOpacity>
      </View>
      {!!docStatus && <Text style={styles.counts} testID="learn-doc-status">{docStatus}</Text>}

      <View style={styles.switchRow}>
        <Text style={styles.switchText}>Also research in the offline library (WikiMed, Wikipedia...)</Text>
        <Switch value={cfg.useLibrary} onValueChange={(v) => setConfig(agentId, { useLibrary: v })} disabled={running} />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchText}>Also research on the web (when online, not in off-grid mode)</Text>
        <Switch value={cfg.useWeb} onValueChange={(v) => setConfig(agentId, { useWeb: v })} disabled={running} />
      </View>

      <View style={styles.statusBox}>
        <Text style={styles.statusText}>{running || !/^(Idle|Stopped|Running|Starting...)$/.test(statusText) ? statusText : 'Idle'}</Text>
        <Text style={styles.counts}>
          Round {st?.round ?? 0} · {count('answered')} learned · {count('approved')} to study · {count('rejected')} rejected{count('failed') ? ` · ${count('failed')} failed` : ''} · reports {st?.totalReports ?? 0}
        </Text>
        <Text style={styles.counts}>
          Until judge: {Math.max(0, cfg.reportsPerJudge - (st?.reportsSinceJudge ?? 0))} reports · until manager: {Math.max(0, cfg.judgesPerManager - (st?.judgesSinceManager ?? 0))} judge turns{st?.onTrack === false ? ' · manager says: drifting' : st?.onTrack ? ' · manager says: on track' : ''}
        </Text>
        {!!st?.scores?.length && (
          <View style={styles.scoreRow}>
            <Text style={styles.counts}>Judge scores (last {Math.min(12, st.scores.length)}): </Text>
            {st.scores.slice(-12).map((v, i) => (
              <View key={i} style={[styles.bar, { height: 4 + v * 2.6, backgroundColor: v >= 7 ? colors.primary : v >= 5 ? '#D97706' : colors.error }]} />
            ))}
            <Text style={styles.counts}>  avg {(st.scores.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, st.scores.length)).toFixed(1)}/10</Text>
          </View>
        )}
        {!!st?.direction && <Text style={styles.direction}>Direction: {st.direction}</Text>}
      </View>

      <View style={styles.row}>
        <TouchableOpacity
          onPress={running ? stopLearning : start}
          disabled={!cfg.topic.trim() && !running}
          style={[styles.bigBtn, { backgroundColor: running ? colors.error : colors.primary }, !cfg.topic.trim() && !running ? styles.dim : undefined]}
        >
          <Icon name={running ? 'square' : 'play'} size={16} color="#fff" />
          <Text style={styles.bigBtnText}>{running ? 'Stop' : 'Start learning'}</Text>
        </TouchableOpacity>
      </View>


      <View style={styles.reportsHead}>
        <Text style={[styles.label, styles.grow]}>Reports it wrote</Text>
        {(st?.reportLog ?? []).length > 0 && (
          <TouchableOpacity onPress={shareReports} style={styles.smallBtn} testID="share-reports" accessibilityRole="button">
            <Text style={styles.smallBtnText}>Share reports</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.note}>Every report the AI writes while it learns, in full, with what the judge said. Tap one to read it.</Text>
      {(st?.reportLog ?? []).length === 0 && <Text style={styles.counts}>No reports yet. Describe a task above and press Start: each report it writes appears here, with its numbered sources.</Text>}
      {(st?.reportLog ?? []).slice(0, 30).map((r) => {
        const isOpen = openReport === r.id;
        const color = r.status === 'pass' ? '#4D7C0F' : r.status === 'fail' ? colors.error : colors.textMuted;
        return (
          <TouchableOpacity key={r.id} onPress={() => setOpenReport(isOpen ? null : r.id)} style={styles.bankRow} testID={`learn-report-${r.id}`} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
            <View style={[styles.dot, { backgroundColor: color }]} />
            <View style={styles.grow}>
              <Text style={styles.chipText}>{r.q}</Text>
              <Text style={[styles.counts, { color }]}>
                {r.status === 'pass' ? 'Judge passed' : r.status === 'fail' ? 'Judge failed' : 'Pending'}{r.score !== undefined ? ` · ${r.score}/10` : ''} · {new Date(r.at).toLocaleString()}
              </Text>
              {isOpen && <Text style={styles.eventBody} selectable>{markSources(r.text, r.sourceList?.length ?? 0)}</Text>}
              {isOpen && !!r.sourceList?.length && (
                <View testID={`report-sources-${r.id}`}>
                  <Text style={styles.counts}>Sources</Text>
                  {r.sourceList.map((s) => (
                    <Text key={s.n} style={styles.counts} selectable>{superscript(s.n)} {s.title} ({s.kind}){s.url ? ` ${s.url}` : ''}</Text>
                  ))}
                </View>
              )}
              {isOpen && !!r.why && <Text style={styles.direction}>Judge: {r.why}</Text>}
              {isOpen && !!r.sources && <Text style={styles.counts} selectable>Sources it had:{'\n'}{r.sources}</Text>}
            </View>
            <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
          </TouchableOpacity>
        );
      })}

      <Text style={styles.label}>{isNoAgent(agentId) ? `${expertName(agentId)} lessons (used in chats about this subject, and saved as a file)` : 'Lessons this agent uses in every chat'}</Text>
      <TextInput
        style={[styles.input, styles.lessons]}
        value={(isNoAgent(agentId) ? st?.lessons : agent?.lessons) || ''}
        editable={!running}
        onChangeText={(t) => setLessons(agentId, t)}
        placeholder="None yet. The manager writes these after auditing the judge. You can edit them."
        placeholderTextColor={colors.textMuted}
        multiline
        textAlignVertical="top"
      />
      <Text style={styles.note}>
        Keep the app open while it learns (the screen stays on). Plugging in is a good idea. The model itself does not
        change: the agent keeps its lessons (added to its instructions) and, in Keep mode with a project chosen, the
        judge-checked answers are saved to that project's documents so chats can use them.
      </Text>

      <TouchableOpacity onPress={() => setAdvanced((v) => !v)} style={styles.advToggle} accessibilityRole="button" testID="learning-advanced">
        <Text style={styles.label}>More options</Text>
        <Icon name={advanced ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
      </TouchableOpacity>
      {advanced && (
        <View>
          <View style={styles.switchRow}>
            <Text style={styles.switchText}>Show which lessons a reply used (a small note under the reply)</Text>
            <Switch value={showLessons} onValueChange={(v) => updateSettings({ showLessonsUsed: v })} testID="show-lessons-used" />
          </View>
      <Text style={styles.label}>Mode</Text>
      <View style={[styles.row, literalStyles.s1]}>
        {([['keep', 'Keep learning', 'Lessons go into the agent; checked answers are saved to the project'], ['session', 'Practice session', 'Temporary: nothing changes unless you tap Keep at the end']] as const).map(([m, t, d]) => (
          <TouchableOpacity key={m} disabled={running} onPress={() => setConfig(agentId, { mode: m })} style={[styles.modeCard, cfg.mode === m && { borderColor: colors.primary }]}>
            <Text style={[styles.chipText, literalStyles.s2]}>{t}</Text>
            <Text style={styles.counts}>{d}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {cfg.mode === 'keep' && (
        <View style={styles.switchRow}>
          <Text style={styles.switchText}>Keep going with new question rounds (constant learning)</Text>
          <Switch value={cfg.continuous} onValueChange={(v) => setConfig(agentId, { continuous: v })} disabled={running} />
        </View>
      )}
      <View style={styles.row}>
        <Stepper label="Questions per round" value={cfg.bankSize} onChange={(v: number) => setConfig(agentId, { bankSize: v })} colors={colors} styles={styles} />
        <Stepper label="Reports per judge" value={cfg.reportsPerJudge} onChange={(v: number) => setConfig(agentId, { reportsPerJudge: v })} colors={colors} styles={styles} />
        <Stepper label="Judge turns per manager" value={cfg.judgesPerManager} onChange={(v: number) => setConfig(agentId, { judgesPerManager: v })} colors={colors} styles={styles} />
      </View>

      <Text style={styles.label}>Models for each role</Text>
      <Text style={styles.note}>
        Optional. A bigger model as judge or manager checks better. Different models mean the app swaps models at each hand-over, which is slower.
      </Text>
      {(['learner', 'judge', 'manager'] as const).map((role) => (
        <View key={role} style={styles.roleRow}>
          <Text style={styles.roleName}>{role[0].toUpperCase() + role.slice(1)}</Text>
          <View style={styles.roleChips}>
            <ModelChips
              value={(cfg as any)[`${role}ModelId`] || ''}
              onChange={(id) => setConfig(agentId, { [`${role}ModelId`]: id } as any)}
              colors={colors}
              disabled={running}
            />
          </View>
        </View>
      ))}

          <TouchableOpacity disabled={running} onPress={() => auditNow(agentId)} style={styles.smallBtn}>
          <Text style={styles.smallBtnText}>Manager audit now</Text>
        </TouchableOpacity>
      <Text style={styles.label}>Question bank</Text>
      <Text style={styles.note}>The learner writes it, the judge approves or rejects (the learner can argue back once), the manager can drop or add questions. Tap a question to open it. You can then approve it, reject it or remove it yourself.</Text>
      {bank.filter((b) => b.status !== 'dropped').slice(-40).map((b) => {
        const isOpen = openQ === b.id;
        return (
          <View key={b.id}>
            <TouchableOpacity onPress={() => setOpenQ(isOpen ? null : b.id)} style={styles.bankRow} testID={`bank-row-${b.id}`} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[b.status] || colors.textMuted }]} />
              <View style={styles.grow}>
                <Text style={styles.chipText}>{b.q}</Text>
                <Text style={[styles.counts, { color: STATUS_COLOR[b.status] }]}>{b.status}{b.appealed ? ' (appealed)' : ''}{b.reason ? ` - ${b.reason}` : ''}</Text>
              </View>
              <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
            </TouchableOpacity>
            {isOpen && (
              <View style={styles.row}>
                <TouchableOpacity disabled={running && b.status !== 'pending'} onPress={() => decide(b.id, 'approved')} style={styles.smallBtn} testID={`bank-approve-${b.id}`} accessibilityRole="button">
                  <Text style={styles.smallBtnText}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={running && b.status !== 'pending'} onPress={() => decide(b.id, 'rejected')} style={styles.smallBtn} testID={`bank-reject-${b.id}`} accessibilityRole="button">
                  <Text style={styles.smallBtnText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={running && b.status !== 'pending'} onPress={() => decide(b.id, 'dropped')} style={styles.smallBtn} testID={`bank-remove-${b.id}`} accessibilityRole="button">
                  <Text style={styles.smallBtnText}>Remove</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}
      <View style={[styles.row, literalStyles.s3]}>
        <TextInput style={[styles.input, styles.grow]} value={newQ} onChangeText={setNewQ} placeholder="Add your own question" placeholderTextColor={colors.textMuted} />
        <TouchableOpacity onPress={() => { if (newQ.trim()) { addItems(agentId, [newItem(newQ, st?.round || 1, 'approved')]); setNewQ(''); } }} style={styles.smallBtn}><Text style={styles.smallBtnText}>Add</Text></TouchableOpacity>
        <TouchableOpacity disabled={running} onPress={() => newRound(agentId)} style={styles.smallBtn}><Text style={styles.smallBtnText}>New round</Text></TouchableOpacity>
      </View>

      {cfg.mode === 'session' && (
        <View style={styles.statusBox}>
          <Text style={styles.statusText}>This practice session</Text>
          <Text style={styles.counts}>{st?.notes?.length ?? 0} checked answers{st?.sessionLessons ? `\nLessons so far:\n${st.sessionLessons}` : ''}</Text>
          <TouchableOpacity disabled={running} onPress={async () => { try { Alert.alert('Done', await keepSession(agentId)); } catch (e: any) { Alert.alert('Could not keep it', String(e?.message || e)); } }} style={[styles.smallBtn, literalStyles.s4]}>
            <Text style={styles.smallBtnText}>Keep what it learned</Text>
          </TouchableOpacity>
        </View>
      )}

          <TouchableOpacity disabled={running} onPress={() => { clearAgent(agentId); setLessons(agentId, ''); }} style={styles.resetBtn}>
            <Text style={styles.resetText}>Reset lessons and history</Text>
          </TouchableOpacity>
          {agentId !== NO_AGENT && isNoAgent(agentId) && (
            <TouchableOpacity disabled={running} onPress={() => Alert.alert(`Delete the ${expertName(agentId)} expert?`, 'Its topic, reports and lessons are removed. This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { removeExpert(agentId); setAgentId(NO_AGENT); } }])} style={styles.resetBtn} testID="delete-expert">
              <Text style={styles.resetText}>Delete this expert</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );

  const feed = (
    <View>
      <Text style={styles.label}>Activity</Text>
      {events.length === 0 && <Text style={styles.note}>Nothing yet. Describe the task and press Start.</Text>}
      {events.map((e: LearnEvent) => (
        <TouchableOpacity key={e.id} onPress={() => setOpen(open === e.id ? null : e.id)} style={styles.event}>
          <View style={styles.eventHead}>
            <Icon name={KIND_ICON[e.kind] || 'circle'} size={14} color={e.kind === 'error' ? colors.error : e.kind === 'manager' ? colors.primary : colors.textSecondary} />
            <Text style={styles.eventTitle}>{e.title}</Text>
            <Text style={styles.eventTime}>{new Date(e.at).toLocaleTimeString()}</Text>
          </View>
          {!!e.body && <Text style={styles.eventBody} numberOfLines={open === e.id ? undefined : 3}>{e.body}</Text>}
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}><Icon name="arrow-left" size={20} color={colors.text} /></TouchableOpacity>
        <Text style={styles.title}>Teach the AI</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Knowledge')} style={styles.back} accessibilityLabel="Knowledge: documents, experts, library, import and export" testID="open-knowledge">
          <Icon name="book-open" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>
      {wide ? (
        <View style={styles.wideRow}>
          <ScrollView style={styles.wideLeft} contentContainerStyle={styles.pad}>{settings}</ScrollView>
          <ScrollView style={styles.wideRight} contentContainerStyle={styles.pad}>{feed}</ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">{settings}{feed}</ScrollView>
      )}
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { marginRight: SPACING.md },
  title: { ...TYPOGRAPHY.h2, color: colors.text },
  pad: { padding: SPACING.lg, paddingBottom: 120 },
  wideRow: { flex: 1, flexDirection: 'row' as const },
  wideLeft: { flex: 1, maxWidth: 560, borderRightWidth: 1, borderRightColor: colors.border },
  wideRight: { flex: 1 },
  label: { ...TYPOGRAPHY.label, color: colors.text, marginTop: SPACING.lg, marginBottom: SPACING.sm, textTransform: 'uppercase' as const },
  input: { ...TYPOGRAPHY.body, backgroundColor: colors.surface, borderRadius: 8, padding: SPACING.md, color: colors.text },
  lessons: { minHeight: 120 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.surface, marginRight: 8 },
  chipOn: { backgroundColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.background },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, marginTop: SPACING.md, gap: 12, flexWrap: 'wrap' as const },
  stepper: { flex: 1, minWidth: 140 },
  stepLabel: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, marginBottom: 4 },
  stepRow: { flexDirection: 'row' as const, alignItems: 'center' as const },
  stepBtn: { width: 34, height: 34, borderRadius: 8, backgroundColor: colors.surface, alignItems: 'center' as const, justifyContent: 'center' as const },
  stepValue: { ...TYPOGRAPHY.body, color: colors.text, width: 36, textAlign: 'center' as const },
  statusBox: { marginTop: SPACING.lg, padding: SPACING.md, borderRadius: 8, backgroundColor: colors.surface },
  statusText: { ...TYPOGRAPHY.body, color: colors.text, fontWeight: '600' as const },
  counts: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, marginTop: 4 },
  roleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, marginTop: 6 },
  roleName: { ...TYPOGRAPHY.bodySmall, color: colors.text, width: 70 },
  roleChips: { flex: 1 },
  scoreRow: { flexDirection: 'row' as const, alignItems: 'flex-end' as const, marginTop: 6, flexWrap: 'wrap' as const },
  bar: { width: 8, marginRight: 3, borderRadius: 2 },
  direction: { ...TYPOGRAPHY.bodySmall, color: colors.primary, marginTop: 6 },
  bigBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, gap: 8 },
  bigBtnText: { color: '#fff', fontWeight: '600' as const, fontSize: 15 },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  smallBtnText: { color: colors.text, fontSize: 13 },
  textbookCard: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, borderWidth: 1, borderColor: colors.primary, borderRadius: 10, padding: SPACING.md, marginTop: SPACING.sm },
  grow: { flex: 1 },
  dim: { opacity: 0.5 },
  reportsHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  expertRow: { marginTop: 4 },
  advToggle: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  resetBtn: { marginTop: SPACING.sm, paddingVertical: 8 },
  modeCard: { flex: 1, minWidth: 150, borderWidth: 2, borderColor: colors.border, borderRadius: 10, padding: SPACING.md, backgroundColor: colors.surface },
  switchRow: { flexDirection: 'row' as const, alignItems: 'center' as const, marginTop: SPACING.md },
  switchText: { ...TYPOGRAPHY.bodySmall, color: colors.text, flex: 1, paddingRight: 8 },
  bankRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10, backgroundColor: colors.surface, borderRadius: 8, padding: SPACING.md, marginTop: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  resetText: { color: colors.error, fontSize: 13 },
  note: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, marginTop: SPACING.md, lineHeight: 18 },
  event: { backgroundColor: colors.surface, borderRadius: 8, padding: SPACING.md, marginBottom: SPACING.sm, ...shadows.small },
  eventHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  eventTitle: { ...TYPOGRAPHY.bodySmall, color: colors.text, fontWeight: '600' as const, flex: 1 },
  eventTime: { fontSize: 11, color: colors.textMuted },
  eventBody: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, marginTop: 6, lineHeight: 18 },
});
