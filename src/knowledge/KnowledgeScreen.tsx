import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { pick, types } from '@react-native-documents/picker';
import { useTheme } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import { Button } from '../components/Button';
import { saveExistingFile } from '../study/exportFiles';
import { resolvePickedFileUri } from '../utils/resolvePickedFileUri';
import type { AgentProfile, Finding, SourceDocument } from './schema';
import type { ImportReport, TransferEntry } from './exchange';
import {
  addPdfs, decide, deleteDocument, evaluateAgent, exportKnowledge, importPackage, listDocuments, listProfiles, pauseStudy,
  previewPackage, snapshotFor, startStudy, transferHistory, useKnowledgeStatus,
} from './controller';

type Tab = 'now' | 'experts' | 'documents' | 'library' | 'transfer';
const TABS: Array<[Tab, string]> = [['now', 'Now'], ['experts', 'Experts'], ['documents', 'Documents'], ['library', 'Library'], ['transfer', 'Transfer']];

const STATUS_LABEL: Record<string, string> = {
  approved: 'Reviewed', provisional: 'Provisional, not reviewed', 'needs-review': 'Needs review', rejected: 'Rejected', conflicted: 'Conflicts with another finding', superseded: 'Replaced',
};

/**
 * Learning dashboard, expert agents, document learning, knowledge library and import/export in one place. It shows what the
 * knowledge services report and sends them the person's intents; the work and the state live in src/knowledge.
 */
export const KnowledgeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const status = useKnowledgeStatus();
  const [tab, setTab] = useState<Tab>('now');
  const [experts, setExperts] = useState<AgentProfile[]>([]);
  const [docs, setDocs] = useState<SourceDocument[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [history, setHistory] = useState<TransferEntry[]>([]);
  const [query, setQuery] = useState('');
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [includePdfs, setIncludePdfs] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ path: string; report: ImportReport } | null>(null);

  const reload = useCallback(async () => {
    setExperts(await listProfiles()); setDocs(await listDocuments()); setHistory(await transferHistory());
    setFindings(await snapshotFor({ text: query || undefined, status: conflictsOnly ? 'conflicted' : undefined, limit: 40 }));
  }, [query, conflictsOnly]);
  useEffect(() => { void reload(); }, [reload, status.version]);

  const addDocuments = async () => {
    try {
      const picked = await pick({ mode: 'open', type: [types.pdf], allowMultiSelection: true });
      const resolved = await Promise.all(picked.map(async (f) => ({ uri: await resolvePickedFileUri(f.uri, f.name || 'document.pdf'), name: f.name || 'document.pdf' })));
      const r = await addPdfs(resolved);
      setNotice(`${r.added} added${r.duplicates ? `, ${r.duplicates} already here` : ''}${r.failed.length ? `. Could not read: ${r.failed.join('; ')}` : ''}.`);
    } catch { /* the picker was closed */ }
  };
  const study = (id: string) => startStudy(id).catch((e) => setNotice(String(e?.message || e)));

  const doExport = async (scope: { kind: 'all' } | { kind: 'agents'; agentIds: string[] } | { kind: 'since' }) => {
    try {
      const { path, manifest } = await exportKnowledge({ scope, includeOriginals: includePdfs });
      const saved = await saveExistingFile(path, path.split('/').pop() as string, 'application/zip');
      setNotice(saved ? `Saved ${saved}: ${manifest.counts.findings} findings, ${manifest.counts.agents} experts.` : 'Export made. You closed the save dialog, so it was not copied anywhere.');
    } catch (e: any) { setNotice(String(e?.message || e)); }
  };
  const chooseImport = async () => {
    try {
      const [file] = await pick({ mode: 'open', type: [types.allFiles], allowMultiSelection: false });
      const path = await resolvePickedFileUri(file.uri, file.name || 'package.zip');
      setPreview({ path, report: await previewPackage(path) });
    } catch { /* closed */ }
  };

  const s = { text: { color: colors.text, ...TYPOGRAPHY.body }, meta: { color: colors.textMuted, ...TYPOGRAPHY.meta }, card: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: SPACING.md, marginBottom: SPACING.sm } };
  const p = status.progress;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: SPACING.md, gap: SPACING.sm }}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back"><Icon name="arrow-left" size={20} color={colors.text} /></TouchableOpacity>
        <Text style={[s.text, { flex: 1 }]}>Knowledge</Text>
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: SPACING.md, gap: SPACING.xs }}>
        {TABS.map(([id, label]) => (
          <TouchableOpacity key={id} onPress={() => setTab(id)} testID={`knowledge-tab-${id}`} style={{ paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm, borderBottomWidth: 2, borderBottomColor: tab === id ? colors.primary : 'transparent' }}>
            <Text style={{ color: tab === id ? colors.primary : colors.textSecondary, ...TYPOGRAPHY.meta }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ padding: SPACING.md }} keyboardShouldPersistTaps="handled">
        {!!notice && <Text style={[s.meta, { marginBottom: SPACING.sm }]} testID="knowledge-notice">{notice}</Text>}

        {tab === 'now' && (
          <View testID="knowledge-now">
            {status.running && p ? (
              <View style={s.card}>
                <Text style={s.text}>Studying: {docs.find((d) => d.sourceId === status.running)?.title ?? 'a document'}</Text>
                <Text style={s.meta}>{p.phase === 'studying' ? `${p.chunksStudied} of ${p.chunksTotal} sections` : p.phase}{p.pages ? ` · ${p.pages} pages` : ''} · {p.findings} findings so far</Text>
                <Button title="Pause" variant="outline" onPress={pauseStudy} testID="knowledge-pause" />
              </View>
            ) : <Text style={s.meta}>Nothing is being studied. Add a PDF under Documents.</Text>}
            {!!status.lastError && <View style={s.card}><Text style={s.text}>Stopped: {status.lastError}</Text><Text style={s.meta}>Nothing was marked as read. Fix it and press Study to continue where it stopped.</Text></View>}
            {status.lastReport && (
              <View style={s.card} testID="knowledge-last-report">
                <Text style={s.text}>Last cycle: {status.lastReport.status}</Text>
                <Text style={s.meta}>Examined {status.lastReport.attempted.chunksExamined} sections · filed {status.lastReport.attempted.findingsGenerated} findings · kept {status.lastReport.retained.provisional} provisional, {status.lastReport.retained.accepted} reviewed</Text>
                <Text style={s.meta}>{status.lastReport.summary}</Text>
              </View>
            )}
            <Text style={s.meta}>This is retrieval knowledge: the model's weights are never trained or changed.</Text>
          </View>
        )}

        {tab === 'experts' && (experts.length ? experts.map((a) => (
          <View key={a.agentId} style={s.card} testID={`expert-${a.agentId}`}>
            <Text style={s.text}>{a.name} · {a.stage === 'expert' ? 'expert' : 'workspace, still gathering evidence'}</Text>
            <Text style={s.meta}>{a.stats.findings} findings ({a.stats.approved} reviewed, {a.stats.provisional} provisional, {a.stats.conflicted} conflicting) · {a.stats.documents} documents · {a.stats.cycles} cycles</Text>
            <Text style={s.meta}>{a.evaluation ? `Can find and cite ${Math.round(a.evaluation.score * 100)}% of its own findings (${a.evaluation.answered} of ${a.evaluation.questions}), measured ${a.evaluation.at.slice(0, 10)}` : 'Not measured yet'}</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              <Button title="Measure" variant="outline" onPress={async () => { await evaluateAgent(a.agentId); await reload(); }} />
              <Button title="Export this expert" variant="outline" onPress={() => doExport({ kind: 'agents', agentIds: [a.agentId] })} />
            </View>
          </View>
        )) : <Text style={s.meta}>No experts yet. Study a document and the matching expert is created.</Text>)}

        {tab === 'documents' && (
          <View>
            <Button title="Add PDFs" onPress={addDocuments} testID="knowledge-add-pdf" />
            {docs.map((d) => (
              <View key={d.sourceId} style={[s.card, { marginTop: SPACING.sm }]} testID={`doc-${d.sourceId}`}>
                <Text style={s.text}>{d.title ?? d.name}</Text>
                <Text style={s.meta}>{d.status}{d.pages ? ` · ${d.pages} pages` : ''} · {d.progress.chunksStudied}/{d.progress.chunksTotal || '?'} sections studied{d.agentId ? ` · ${d.agentId}` : ''}</Text>
                {d.unreadablePages.length > 0 && <Text style={s.meta}>{d.unreadablePages.length} pages have no readable text (scans) and were not studied.</Text>}
                {!!d.error && <Text style={s.meta}>{d.error}</Text>}
                <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                  {d.status !== 'done' && <Button title={status.running === d.sourceId ? 'Studying...' : d.progress.chunksStudied ? 'Resume' : 'Study'} disabled={!!status.running} onPress={() => study(d.sourceId)} testID={`doc-study-${d.sourceId}`} />}
                  <Button title="Remove" variant="outline" onPress={() => Alert.alert('Remove this source?', 'The PDF, its text and the knowledge that rests only on it are deleted.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => deleteDocument(d.sourceId).then((n) => setNotice(`Removed. ${n} findings erased.`)) }])} />
                </View>
              </View>
            ))}
          </View>
        )}

        {tab === 'library' && (
          <View>
            <TextInput value={query} onChangeText={setQuery} placeholder="Search what has been learned" placeholderTextColor={colors.textMuted} testID="knowledge-search"
              style={{ borderWidth: 1, borderColor: colors.border, color: colors.text, padding: SPACING.sm, marginBottom: SPACING.sm }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm }}>
              <Switch value={conflictsOnly} onValueChange={setConflictsOnly} /><Text style={s.meta}>Only findings that conflict</Text>
            </View>
            {findings.map((f) => (
              <View key={f.recordId} style={s.card} testID={`finding-${f.recordId}`}>
                <Text style={[s.meta, { color: f.status === 'approved' ? colors.primary : colors.textMuted }]}>{STATUS_LABEL[f.status] ?? f.status}</Text>
                <Text style={s.text}>{f.finding}</Text>
                <Text style={s.meta}>{f.evidence.map((e) => `${f.documentTitle ?? e.sourceId}${e.page ? `, page ${e.page}` : ''}`).join('; ') || 'no citation'}</Text>
                {!!f.uncertainty && <Text style={s.meta}>Unclear: {f.uncertainty}</Text>}
                {f.status !== 'approved' && f.status !== 'rejected' && (
                  <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                    <Button title="Approve" variant="outline" onPress={() => decide(f.recordId, 'approved')} />
                    <Button title="Reject" variant="outline" onPress={() => decide(f.recordId, 'rejected')} />
                  </View>
                )}
              </View>
            ))}
            {!findings.length && <Text style={s.meta}>Nothing found.</Text>}
          </View>
        )}

        {tab === 'transfer' && (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm }}>
              <Switch value={includePdfs} onValueChange={setIncludePdfs} /><Text style={s.meta}>Include the original PDFs (larger, and may contain private material)</Text>
            </View>
            <Text style={s.meta}>Nothing leaves this phone until you pick where to save the file.</Text>
            <View style={{ gap: SPACING.sm, marginVertical: SPACING.sm }}>
              <Button title="Export everything" onPress={() => doExport({ kind: 'all' })} testID="knowledge-export-all" />
              <Button title="Export changes since the last export" variant="outline" onPress={() => doExport({ kind: 'since' })} />
              <Button title="Import a package" variant="outline" onPress={chooseImport} testID="knowledge-import" />
            </View>
            <Text style={s.meta}>Exports use the Atlas learning interchange format. Street Advisory needs an adapter to read it; that adapter is not part of Atlas.</Text>
            {preview && (
              <View style={[s.card, { marginTop: SPACING.sm }]} testID="knowledge-import-preview">
                {preview.report.valid ? (
                  <>
                    <Text style={s.text}>Would import {preview.report.imported.findings} findings, {preview.report.imported.agents} experts, {preview.report.imported.documents} documents.</Text>
                    <Text style={s.meta}>{preview.report.duplicates} already here · {preview.report.tombstoned} blocked because they were deleted · {preview.report.rejected.length} rejected · {preview.report.deferred.length} deferred</Text>
                    <Button title="Import" onPress={async () => { const r = await importPackage(preview.path); setPreview(null); setNotice(`Imported ${r.imported.findings} findings. ${r.conflicts.length} conflict(s) kept for review.`); }} testID="knowledge-import-apply" />
                  </>
                ) : <Text style={s.text}>Cannot import: {preview.report.refused.join(' ')}</Text>}
              </View>
            )}
            {history.map((h) => (
              <Text key={h.id} style={s.meta}>{h.at.slice(0, 16).replace('T', ' ')} · {h.kind} · {h.counts.findings ?? 0} findings{h.note ? ` · ${h.note}` : ''}</Text>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};
