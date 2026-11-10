/**
 * Atlas learning mode: a research cycle that runs entirely on the phone with the loaded model(s).
 *
 *  1. Question bank  - the Learner turns the task into a bank of study questions.
 *                      The Judge approves each one or rejects it (off-topic, vague, unsafe, duplicate).
 *                      The Learner may fight a rejection once (argue or rewrite); the Judge rules again.
 *  2. Study          - the Learner works through the approved questions, researching the project's
 *                      documents (and optionally the offline library / web), and writes a simple report.
 *                      Every N reports the Judge checks that each report makes logical sense and follows
 *                      from its sources. Failed reports go back for one redo with the Judge's feedback.
 *  3. Manager        - every M judge turns the Manager reviews the Learner AND the Judge against the
 *                      original task: are they on track? It can drop off-task questions, add missing ones,
 *                      steer the Learner, correct the Judge, and keep the agent's lesson list short.
 *
 * Nothing is fine-tuned: model weights never change. What the agent keeps (keep mode) is its lesson list
 * (added to its instructions) and the judge-approved answers (saved into the project's knowledge base).
 * In session mode nothing changes until you tap "Keep what it learned".
 */
import { runBackgroundJob, fitPrompt } from '../services/llmJobQueue';
import RNFS from 'react-native-fs';
import { localUniqueId } from '../utils/uniqueId';
import { llmService } from '../services/llm';
import { activeModelService } from '../services/activeModelService';
import { ragService } from '../services/rag';
import { useAppStore } from '../stores/appStore';
import { Agent, agentPromptWithLessons } from '../stores/agentStore';
import { learningAgent, setLessons } from './agents';
import { useLearningStore, newItem, BankItem, LearnConfig, LearnReport, ReportSource, PerAgent } from './store';
import type { Message } from '../types';
import logger from '../utils/logger';
import { ensureTextModel } from '../atlasTools/models';

let running = false;
let stopRequested = false;
let statusListener: ((s: string) => void) | null = null;

export const isLearning = (): boolean => running;
export const onLearningStatus = (fn: ((s: string) => void) | null): void => { statusListener = fn; };
const status = (s: string) => statusListener?.(s);

const msg = (role: Message['role'], content: string): Message => ({
  id: localUniqueId(role), role, content, timestamp: Date.now(),
});
const clean = (t: string): string => t.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').replace(/\*\*/g, '').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const L = () => useLearningStore.getState();

type Role = 'learner' | 'judge' | 'manager';
let roleModels: Record<Role, string> = { learner: '', judge: '', manager: '' };
let baseModel = '';

async function ensureModel(): Promise<void> {
  if (llmService.isModelLoaded()) return;
  const id = useAppStore.getState().activeModelId;
  if (!id) throw new Error('No model selected. Load a text model first (Models tab).');
  status('Loading the model...');
  await activeModelService.loadTextModel(id);
  if (!llmService.isModelLoaded()) throw new Error('The model could not be loaded.');
}

async function ask(system: string, user: string, role: Role): Promise<string> {
  if (llmService.isCurrentlyGenerating()) status('Waiting for the chat to finish...');
  return runBackgroundJob(async () => {
  if (stopRequested) throw new Error('stopped');
  if (new Set([roleModels.learner, roleModels.judge, roleModels.manager]).size > 1 || roleModels[role] !== baseModel) {
    await ensureTextModel(roleModels[role] || null, status);
  }
  await ensureModel();
  // Keep the prompt inside the model's memory (about 3 characters per token).
  const ctx = llmService.getPerformanceSettings().contextLength || 2048;
  const maxChars = Math.max(2500, (ctx - 700) * 3);
  // Keep both the start (task) and the end (instructions and reply format) when trimming;
  // cutting only the end used to drop the instructions, so the reply could not be parsed.
  const u = fitPrompt(user, Math.max(800, maxChars - system.length));
  const out = await llmService.generateResponse([msg('system', system), msg('user', u)], { disableThinking: true });
  return clean(out);
  }, { maxWaitMs: 30 * 60_000, shouldStop: () => stopRequested });
}

// ------------------------------------------------------------------ research
/** What the learner read for a question: the text it is shown (each source numbered) and the same sources as a list. */
interface Research { text: string; list: ReportSource[] }

async function research(cfg: LearnConfig, query: string): Promise<Research> {
  const found: Array<{ title: string; kind: ReportSource['kind']; content: string; url?: string }> = [];
  if (cfg.projectId) {
    try {
      const res: any = await ragService.searchProject(cfg.projectId, query);
      (res?.chunks || []).slice(0, 3).forEach((c: any) => found.push({ title: String(c.name), kind: 'project', content: String(c.content).replace(/\s+/g, ' ').slice(0, 800) }));
    } catch (e) { logger.log(`[Learning] knowledge search failed: ${String(e)}`); }
  }
  if (cfg.useLibrary) {
    try {
      const { searchLibrary, readArticle } = require('../atlasTools/offlineLibrary');
      const hits = await searchLibrary(query, 2);
      for (const h of hits.slice(0, 1)) {
        const a = await readArticle(h.uri, h.path, 900);
        found.push({ title: `${h.library}: ${a.title}`, kind: 'library', content: a.text.replace(/\s+/g, ' ').slice(0, 800) });
      }
    } catch { /* no library */ }
  }
  if (cfg.useWeb) {
    try {
      const { offGridOn } = require('../atlasTools/offGrid');
      if (!offGridOn()) {
        const { searchWeb } = require('../services/tools/webSearchProviders');
        const r = await searchWeb(query, (q: string) => require('../services/tools/handlers').braveSearch(q));
        r.results.slice(0, 2).forEach((w: any) => { if (w.snippet) found.push({ title: String(w.title), kind: 'web', content: w.snippet.slice(0, 500), url: w.url }); });
      }
    } catch { /* offline */ }
  }
  return {
    text: found.map((f, i) => `[${i + 1}] (${f.title}) ${f.content}`).join('\n\n'),
    list: found.map((f, i) => ({ n: i + 1, title: f.title, kind: f.kind, url: f.url })),
  };
}

const numbered = (items: { q: string }[]) => items.map((b, i) => `${i + 1}. ${b.q}`).join('\n');
/** Parses lines like "3: APPROVE" / "3 - REJECT: off topic" / "Q3 REJECT (vague)". */
function rulings(text: string, n: number): Map<number, { ok: boolean; reason: string }> {
  const out = new Map<number, { ok: boolean; reason: string }>();
  for (const line of text.split('\n')) {
    const clean = line.replace(/\*\*/g, '');
    const V = '(APPROVE[D]?|ACCEPT(?:ED)?|PASS(?:ED)?|OK|REJECT(?:ED)?|FAIL(?:ED)?)';
    const V2 = '(APPROVE[D]?|ACCEPT(?:ED)?|PASS(?:ED)?|REJECT(?:ED)?|FAIL(?:ED)?)'; // later on the line: no bare "ok" (questions use it)
    // Prefer a verdict right after the number; otherwise the first verdict word later on the line.
    const m = clean.match(new RegExp(`^\\s*(?:[-*•]\\s*)?(?:Q(?:uestion)?|R(?:eport)?|#)?\\s*(\\d{1,2})\\s*[:.)\\-–—]?\\s*(?:[-–—:]\\s*)?${V}\\b\\s*[:\\-–—(]*\\s*(.*)$`, 'i'))
      || clean.match(new RegExp(`^\\s*(?:[-*•]\\s*)?(?:Q(?:uestion)?|R(?:eport)?|#)?\\s*(\\d{1,2})\\b[^\\n]*?[\\s:–—-]${V2}\\b\\s*[:\\-–—(]*\\s*(.*)$`, 'i'));
    if (!m) continue;
    const i = Number(m[1]);
    if (i < 1 || i > n) continue;
    out.set(i, { ok: /^(APPROVE|ACCEPT|PASS|OK)/i.test(m[2]), reason: m[3].replace(/\)\s*$/, '').trim() });
  }
  return out;
}
/**
 * Lines like "LESSON: ...", "Lessons 2 - ...", "Q3: ..." -> their text. A bare "LESSONS:" header
 * followed by a bullet/numbered list also counts (small models often answer that way).
 */
function tagged(text: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`^${tag.replace(/ /g, '\\s*')}(?:S|ES)?\\s*\\d*\\s*[:\\-–.)]\\s*(.*)$`, 'i');
  const anyTag = /^[A-Z][A-Z ]{1,15}\s*\d*\s*[:\-–]/;
  let inList = false;
  for (const raw of text.replace(/\*\*/g, '').split('\n')) {
    const l = raw.trim().replace(/^[-*•]\s+/, '');
    const m = l.replace(/^\d+[.)]\s+/, '').match(re) || l.match(re);
    if (m) { if (m[1].trim()) out.push(m[1].trim()); inList = !m[1].trim(); continue; }
    if (inList) {
      if (!l || anyTag.test(l)) { inList = false; continue; }
      const item = l.replace(/^\d+[.)]\s*/, '').trim();
      if (item) out.push(item);
    }
  }
  return out.filter((x) => x.length > 3);
}

function learnerSystem(agent: Agent, st: PerAgent, cfg: LearnConfig): string {
  let s = agentPromptWithLessons(agent);
  if (cfg.mode === 'session' && st.sessionLessons.trim()) s += `\n\nLessons from this practice session:\n${st.sessionLessons}`;
  if (st.direction) s += `\n\nDirection from your manager: ${st.direction}`;
  return s;
}

// ------------------------------------------------------------------ 1. question bank
async function buildBank(agent: Agent, cfg: LearnConfig): Promise<void> {
  const st = L().get(agent.id);
  const round = st.round + 1;
  const done = st.bank.filter((b) => b.status === 'answered').map((b) => b.q).slice(-25);
  const gaps = st.bank.filter((b) => b.status === 'failed').map((b) => b.q).slice(-8);
  status(`Learner is writing question bank (round ${round})...`);
  const raw = await ask(
    'You plan how to become an expert. You write a bank of specific study questions. Output only the questions, one per line, each starting with "Q: ".',
    `TASK: ${cfg.topic}\n${st.direction ? `Manager direction: ${st.direction}\n` : ''}${done.length ? `Already learned (do not repeat):\n${done.join('\n')}\n` : ''}${gaps.length ? `Still not answered well (rephrase or split these):\n${gaps.join('\n')}\n` : ''}Write ${cfg.bankSize} study questions that together cover what an expert needs to know to do this task well: the basics first, then practical steps, warning signs, common mistakes and edge cases. Each question must be answerable in a short report.`,
    'learner',
  );
  let qs = tagged(raw, 'Q(?:UESTION)?');
  if (qs.length < 2) qs = raw.split('\n').map((l) => l.replace(/^[-*\d.)\s]+/, '').trim()).filter((l) => l.endsWith('?'));
  qs = [...new Set(qs.map((q) => q.slice(0, 300)))].slice(0, cfg.bankSize + 2);
  if (!qs.length) throw new Error('The learner did not write any questions. Try again or use a bigger model.');
  const items = qs.map((q) => newItem(q, round));
  L().addItems(agent.id, items);
  L().patch(agent.id, { round });
  L().log({ agentId: agent.id, kind: 'bank', title: `Question bank, round ${round} (${items.length})`, body: numbered(items) });

  // Judge reviews the bank.
  status('Judge is reviewing the question bank...');
  const verdict = await ask(
    `You are the judge. You check that study questions stay on the task, are specific, safe and not duplicates.${st.judgeNote ? `\nManager's note to you: ${st.judgeNote}` : ''}`,
    `TASK: ${cfg.topic}\n\nQUESTIONS:\n${numbered(items)}\n\nFor EVERY question write one line: "<number>: APPROVE" or "<number>: REJECT - <short reason>". Reject only questions that are off the task, too vague, unsafe, or duplicates.`,
    'judge',
  );
  const r = rulings(verdict, items.length);
  const rejected: BankItem[] = [];
  items.forEach((it, i) => {
    const v = r.get(i + 1);
    if (!v || v.ok) L().updateItem(agent.id, it.id, { status: 'approved' });
    else { L().updateItem(agent.id, it.id, { status: 'rejected', reason: v.reason || 'rejected' }); rejected.push({ ...it, reason: v.reason }); }
  });
  L().log({ agentId: agent.id, kind: 'judge', title: `Judge: ${items.length - rejected.length} approved, ${rejected.length} rejected`, body: verdict.slice(0, 2500) });
  if (!rejected.length || stopRequested) return;

  // Learner may fight back.
  status('Learner is answering the rejections...');
  const appeal = await ask(
    'You defend your study plan honestly. If a rejection is fair, accept it. If it is wrong, argue briefly, or rewrite the question so it is acceptable.',
    `TASK: ${cfg.topic}\n\nRejected questions:\n${rejected.map((b, i) => `${i + 1}. ${b.q}\n   Judge: ${b.reason}`).join('\n')}\n\nFor each, write one line: "<number>: ACCEPT" or "<number>: APPEAL - <why it belongs>" or "<number>: REWRITE - <new question>".`,
    'learner',
  );
  const appeals: { item: BankItem; text: string; rewrite: boolean }[] = [];
  for (const line of appeal.split('\n')) {
    const m = line.replace(/\*\*/g, '').match(/^\s*(?:[-*•]\s*)?(?:Q)?\s*(\d{1,2})\s*[:.)\-–—]?\s*(ACCEPT|APPEAL|REWRITE)\b\s*[:\-–—]*\s*(.*)$/i);
    if (!m) continue;
    const item = rejected[Number(m[1]) - 1];
    if (!item || /ACCEPT/i.test(m[2]) || !m[3].trim()) continue;
    appeals.push({ item, text: m[3].trim().slice(0, 300), rewrite: /REWRITE/i.test(m[2]) });
  }
  if (!appeals.length) return;
  L().log({ agentId: agent.id, kind: 'appeal', title: `Learner appeals ${appeals.length}`, body: appeals.map((a, i) => `${i + 1}. ${a.rewrite ? 'Rewrite' : 'Appeal'}: ${a.text}\n   (was: ${a.item.q})`).join('\n') });
  status('Judge is ruling on the appeals...');
  const final = await ask(
    'You are the judge, ruling on appeals. Be fair: approve if the argument or the rewritten question is reasonable and on the task.',
    `TASK: ${cfg.topic}\n\n${appeals.map((a, i) => `${i + 1}. Original: ${a.item.q}\n   Your reason: ${a.item.reason}\n   Learner ${a.rewrite ? 'rewrote it as' : 'argues'}: ${a.text}`).join('\n')}\n\nFor each write "<number>: APPROVE" or "<number>: REJECT - <reason>". This decision is final.`,
    'judge',
  );
  const fr = rulings(final, appeals.length);
  let won = 0;
  appeals.forEach((a, i) => {
    const v = fr.get(i + 1);
    if (v?.ok) { won++; L().updateItem(agent.id, a.item.id, { status: 'approved', q: a.rewrite ? a.text : a.item.q, appealed: true, reason: undefined }); }
    else L().updateItem(agent.id, a.item.id, { appealed: true, reason: v?.reason || a.item.reason });
  });
  L().log({ agentId: agent.id, kind: 'judge', title: `Appeals: ${won} won, ${appeals.length - won} lost`, body: final.slice(0, 1500) });
}

// ------------------------------------------------------------------ 2. study + reports
async function writeReport(agent: Agent, cfg: LearnConfig, item: BankItem): Promise<void> {
  const st = L().get(agent.id);
  status(`Learner is researching: ${item.q.slice(0, 60)}...`);
  const { text: src, list: sourceList } = await research(cfg, item.q);
  if (stopRequested) return;
  status('Learner is writing a report...');
  const report = await ask(
    learnerSystem(agent, st, cfg),
    `${src ? `SOURCES:\n${src}\n\n` : 'No sources found: use what you know, and say so.\n\n'}TASK: ${cfg.topic}\nQUESTION: ${item.q}\n${item.feedback ? `Judge feedback on your last try: ${item.feedback}\n` : ''}\nWrite a simple report:\nANSWER: 2-5 plain sentences.\nKEY POINTS: 2-4 short bullets.\nREASONING: why this is right, step by step, and which source supports it. Cite each source you use by its number in square brackets, like [1].\nUNSURE: anything you could not confirm (or "nothing").`,
    'learner',
  );
  L().log({ agentId: agent.id, kind: 'report', title: `Report: ${item.q.slice(0, 70)}`, body: report.slice(0, 2500) });
  const entry: LearnReport = { id: `${item.id}:${item.tries + 1}`, itemId: item.id, q: item.q, text: report.slice(0, 8000), sources: src.slice(0, 3000), sourceList, at: Date.now(), status: 'waiting' };
  L().patch(agent.id, {
    reportLog: [entry, ...(st.reportLog ?? [])].slice(0, 100),
    pendingReports: [...st.pendingReports, { itemId: item.id, q: item.q, report: report.slice(0, 1600), sources: src.slice(0, 1200) }],
    reportsSinceJudge: st.reportsSinceJudge + 1,
    totalReports: st.totalReports + 1,
  });
  L().updateItem(agent.id, item.id, { tries: item.tries + 1 });
}

async function saveNote(agent: Agent, cfg: LearnConfig, q: string, answer: string): Promise<void> {
  if (cfg.mode !== 'keep' || !cfg.projectId) return;
  try {
    const dir = `${RNFS.DocumentDirectoryPath}/learned`;
    await RNFS.mkdir(dir);
    const slug = q.replace(/[^\w ]+/g, '').trim().split(/\s+/).slice(0, 8).join('_').slice(0, 60) || 'note';
    const name = `Learned - ${agent.name} - ${slug} ${Date.now() % 100000}.md`;
    const path = `${dir}/${name.replace(/[\\/:*?"<>|]/g, '')}`;
    const body = `# ${q}\n\n${answer}\n\n(Learned by the ${agent.name} agent in learning mode on ${new Date().toLocaleDateString()}, checked by the judge.)\n`;
    await RNFS.writeFile(path, body, 'utf8');
    await ragService.indexDocument({ projectId: cfg.projectId, filePath: path, fileName: name, fileSize: body.length });
  } catch (e) { logger.log(`[Learning] could not save note: ${String(e)}`); }
}

/** Records the judge's ruling on the newest report written for a question. */
function markReport(agentId: string, itemId: string, patch: Partial<LearnReport>): void {
  const log = L().get(agentId).reportLog ?? [];
  const i = log.findIndex((r) => r.itemId === itemId);
  if (i < 0) return;
  L().patch(agentId, { reportLog: log.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
}

async function judgeReports(agent: Agent, cfg: LearnConfig): Promise<void> {
  const st = L().get(agent.id);
  const reps = st.pendingReports;
  if (!reps.length) return;
  status('Judge is checking the reports...');
  const verdict = await ask(
    `You are a strict but fair judge. Check each report: does it answer the question, does the reasoning make logical sense, does it follow from its sources, is anything unsafe or invented?${st.judgeNote ? `\nManager's note to you: ${st.judgeNote}` : ''}${st.direction ? `\nCurrent direction: ${st.direction}` : ''}`,
    `TASK: ${cfg.topic}\n\n${reps.map((r, i) => `REPORT ${i + 1}\nQuestion: ${r.q}\n${r.report}\nSources it had: ${r.sources ? r.sources.slice(0, 700) : '(none)'}`).join('\n\n---\n\n')}\n\nFor each report write one line: "<number>: PASS <score>/10 - <why>" or "<number>: FAIL <score>/10 - <what is wrong and how to fix it>". Then 1-3 lines starting "LESSON:" with a short rule the learner should follow from now on.`,
    'judge',
  );
  const r = rulings(verdict, reps.length);
  const scores: number[] = [];
  let pass = 0;
  for (let i = 0; i < reps.length; i++) {
    const rep = reps[i];
    const v = r.get(i + 1);
    const line = verdict.replace(/\*\*/g, '').split('\n').find((l) => new RegExp(`^\\s*(?:[-*•]\\s*)?(?:R(?:eport)?|#)?\\s*${i + 1}\\s*[:.)\\-–]`, 'i').test(l)) || '';
    const sc = line.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
    if (sc) scores.push(Math.min(10, parseFloat(sc[1])));
    const item = L().get(agent.id).bank.find((b) => b.id === rep.itemId);
    if (!item) continue;
    markReport(agent.id, rep.itemId, { status: v ? (v.ok ? 'pass' : 'fail') : 'waiting', score: sc ? parseFloat(sc[1]) : undefined, why: v?.reason });
    if (!v) {
      // No clear verdict: never count it as learned. Try once more, then give up on it.
      if (item.tries < 2) L().updateItem(agent.id, item.id, { status: 'approved', feedback: 'The judge could not read your report clearly. Use the ANSWER / KEY POINTS / REASONING format.' });
      else L().updateItem(agent.id, item.id, { status: 'failed', reason: 'No clear verdict from the judge' });
      continue;
    }
    if (v.ok) {
      pass++;
      L().updateItem(agent.id, item.id, { status: 'answered', reason: undefined });
      const cur = L().get(agent.id);
      // The judge read a shortened copy; what is kept and saved is the full report.
      const full = (cur.reportLog ?? []).find((r) => r.itemId === rep.itemId)?.text ?? rep.report;
      L().patch(agent.id, { notes: [{ q: rep.q, answer: full, at: Date.now(), score: sc ? parseFloat(sc[1]) : undefined }, ...cur.notes].slice(0, 200) });
      await saveNote(agent, cfg, rep.q, full);
    } else if (item.tries < 2) {
      L().updateItem(agent.id, item.id, { status: 'approved', feedback: v.reason }); // back in the queue for one redo
    } else {
      L().updateItem(agent.id, item.id, { status: 'failed', reason: v.reason });
    }
  }
  const lessons = tagged(verdict, 'LESSON');
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  L().log({ agentId: agent.id, kind: 'judge', title: `Judge: ${pass}/${reps.length} reports pass`, body: verdict.slice(0, 2500) });
  const cur = L().get(agent.id);
  L().patch(agent.id, {
    pendingReports: [],
    reportsSinceJudge: 0,
    judgesSinceManager: cur.judgesSinceManager + 1,
    scores: avg === null ? cur.scores : [...cur.scores, Math.round(avg * 10) / 10].slice(-50),
    pendingFindings: [...cur.pendingFindings, ...lessons, `(judge: ${pass}/${reps.length} passed) ${verdict.slice(0, 300)}`].slice(-30),
  });
}

// ------------------------------------------------------------------ 3. manager
async function managerReview(agent: Agent, cfg: LearnConfig): Promise<void> {
  const st = L().get(agent.id);
  status('Manager is reviewing the learner and the judge...');
  const open = st.bank.filter((b) => b.status === 'approved');
  const recent = L().events.filter((e) => e.agentId === agent.id && (e.kind === 'judge' || e.kind === 'report')).slice(0, 6).reverse();
  const currentLessons = cfg.mode === 'keep' ? agent.lessons || '' : st.sessionLessons;
  const out = await ask(
    'You are the manager. You make sure the learner and the judge stay on the ORIGINAL task. You catch drift, a judge that is too harsh or too lenient, and gaps in the study plan. You never approve unsafe or unsupported lessons.',
    `ORIGINAL TASK: ${cfg.topic}\n\nOpen questions:\n${numbered(open).slice(0, 1500) || '(none)'}\n\nRejected by the judge:\n${st.bank.filter((b) => b.status === 'rejected').slice(-6).map((b) => `- ${b.q} (${b.reason})`).join('\n') || '(none)'}\n\nRecent work:\n${recent.map((e) => `${e.title}\n${e.body.slice(0, 450)}`).join('\n\n').slice(0, 3200)}\n\nJudge findings:\n${st.pendingFindings.join('\n').slice(0, 1500)}\n\nCurrent lessons:\n${currentLessons || '(none)'}\n\nReply with exactly these parts:\nSTATUS: ON TRACK or DRIFTING, and one sentence why\nDIRECTION: one sentence telling the learner what to focus on next\nJUDGE NOTE: one sentence on how the judge should judge (too harsh, too lenient, or fine)\nDROP: number of an open question that is off the task (one line each, or none)\nADD: a missing question that matters for the task (0-3 lines)\nLESSON: the full lesson list, one per line, at most 12, merged and corrected`,
    'manager',
  );
  const statusLine = tagged(out, 'STATUS')[0] || '';
  const onTrack = statusLine ? !/DRIFT/i.test(statusLine) : st.onTrack;
  const direction = tagged(out, 'DIRECTION')[0] || st.direction;
  const judgeNote = tagged(out, 'JUDGE NOTE')[0] || st.judgeNote;
  const drops = tagged(out, 'DROP').map((d) => Number(d.match(/\d+/)?.[0])).filter((n) => n >= 1 && n <= open.length);
  drops.forEach((n) => L().updateItem(agent.id, open[n - 1].id, { status: 'dropped', reason: 'Manager: off the task' }));
  const adds = tagged(out, 'ADD').filter((a) => a.length > 8 && !/^none/i.test(a)).slice(0, 3);
  if (adds.length) L().addItems(agent.id, adds.map((q) => newItem(q, st.round, 'approved')));
  const lessons = tagged(out, 'LESSON').slice(0, 12);
  if (lessons.length) {
    const text = lessons.map((l) => `- ${l}`).join('\n');
    if (cfg.mode === 'keep') setLessons(agent.id, text);
    else L().patch(agent.id, { sessionLessons: text });
  }
  L().log({
    agentId: agent.id, kind: 'manager',
    title: `Manager: ${onTrack === false ? 'drifting, steering back' : 'on track'}`,
    body: `${statusLine}\nDirection: ${direction || '-'}\nJudge note: ${judgeNote || '-'}${drops.length ? `\nDropped: ${drops.map((n) => open[n - 1]?.q).join('; ')}` : ''}${adds.length ? `\nAdded: ${adds.join('; ')}` : ''}\n\nLessons${cfg.mode === 'session' ? ' (this session)' : ''}:\n${lessons.map((l) => `- ${l}`).join('\n') || '(unchanged)'}`,
  });
  L().patch(agent.id, { judgesSinceManager: 0, pendingFindings: [], direction, judgeNote, onTrack });
}

// ------------------------------------------------------------------ loop
export async function startLearning(agentId: string): Promise<void> {
  if (running) return;
  running = true;
  stopRequested = false;
  baseModel = useAppStore.getState().activeModelId || '';
  L().log({ agentId, kind: 'info', title: 'Learning started', body: '' });
  let problems = 0;
  const startedRound = L().get(agentId).round;
  let workedThisRun = false;
  try {
    while (!stopRequested) {
      const agent = learningAgent(agentId);
      const cfg = L().getConfig(agentId);
      roleModels = { learner: cfg.learnerModelId || baseModel, judge: cfg.judgeModelId || baseModel, manager: cfg.managerModelId || baseModel };
      if (!agent) throw new Error('Agent not found');
      if (!cfg.topic.trim()) throw new Error('Set a task first');
      try {
        const st = L().get(agentId);
        const next = st.bank.find((b) => b.status === 'approved' && !st.pendingReports.some((p) => p.itemId === b.id));
        if (!next) {
          if (st.pendingReports.length) { await judgeReports(agent, cfg); continue; }
          const rounds = st.round;
          if (rounds > 0 && (rounds > startedRound || workedThisRun) && (cfg.mode === 'session' || !cfg.continuous)) {
            L().log({ agentId, kind: 'info', title: 'Question bank finished', body: cfg.mode === 'session' ? 'Practice session done. Tap "Keep what it learned" to give the lessons and answers to the agent, or start again for another round.' : 'All questions are done. Start again for a new round.' });
            if (st.judgesSinceManager > 0 || st.pendingFindings.length) await managerReview(agent, cfg);
            stopRequested = true;
            break;
          }
          await buildBank(agent, cfg);
          continue;
        }
        await writeReport(agent, cfg, next);
        workedThisRun = true;
        if (stopRequested) break;
        const st2 = L().get(agentId);
        const noMoreQuestions = !st2.bank.some((b) => b.status === 'approved' && !st2.pendingReports.some((p) => p.itemId === b.id));
        if (st2.reportsSinceJudge >= Math.max(1, cfg.reportsPerJudge) || noMoreQuestions) {
          await judgeReports(learningAgent(agentId)!, cfg);
          if (L().get(agentId).judgesSinceManager >= Math.max(1, cfg.judgesPerManager) && !stopRequested) {
            await managerReview(learningAgent(agentId)!, cfg);
          }
        }
        problems = 0;
      } catch (e: any) {
        if (String(e?.message) === 'stopped') break;
        L().log({ agentId, kind: 'error', title: 'Problem', body: String(e?.message || e) });
        if (/No model|could not be loaded|Set a task|not found/.test(String(e?.message)) || ++problems >= 4) break;
        status('Pausing after a problem...');
        await sleep(5000);
      }
    }
  } finally {
    running = false;
    stopRequested = false;
    L().log({ agentId, kind: 'info', title: 'Learning stopped', body: '' });
    // Put back the user's model only if learning itself swapped to a role model.
    const loaded = useAppStore.getState().loadedTextModelId;
    if (baseModel && loaded !== baseModel && [roleModels.learner, roleModels.judge, roleModels.manager].includes(loaded || '')) ensureTextModel(baseModel).catch(() => undefined);
    status('Stopped');
  }
}

/** Mark the current bank as finished so the next start makes a fresh round (and wakes a stopped loop). */
export function newRound(agentId: string): void {
  const st = L().get(agentId);
  L().patch(agentId, { bank: st.bank.map((b) => (b.status === 'approved' || b.status === 'pending' ? { ...b, status: 'dropped' as const, reason: 'New round started' } : b)), pendingReports: [] });
}

export function stopLearning(): void {
  if (!running) return;
  stopRequested = true;
  status('Stopping after this step...');
}

/** Run the manager now. */
export async function auditNow(agentId: string): Promise<void> {
  const agent = learningAgent(agentId);
  const cfg = L().getConfig(agentId);
  if (!agent || running) return;
  running = true;
  baseModel = useAppStore.getState().activeModelId || '';
  roleModels = { learner: cfg.learnerModelId || baseModel, judge: cfg.judgeModelId || baseModel, manager: cfg.managerModelId || baseModel };
  try { await managerReview(agent, cfg); } catch (e: any) { L().log({ agentId, kind: 'error', title: 'Problem', body: String(e?.message || e) }); } finally { running = false; status('Idle'); }
}

/** Session mode: give the session's lessons and judge-approved answers to the agent. */
export async function keepSession(agentId: string): Promise<string> {
  const agent = learningAgent(agentId);
  const cfg = L().getConfig(agentId);
  const st = L().get(agentId);
  if (!agent) return 'Agent not found';
  const merged = [agent.lessons?.trim(), st.sessionLessons.trim()].filter(Boolean).join('\n');
  const lines = [...new Set(merged.split('\n').map((l) => l.trim()).filter(Boolean))].slice(-16);
  setLessons(agentId, lines.join('\n'));
  let saved = 0;
  if (cfg.projectId) {
    for (const n of st.notes.slice(0, 60)) { await saveNote(agent, { ...cfg, mode: 'keep' }, n.q, n.answer); saved++; }
  }
  L().patch(agentId, { sessionLessons: '', notes: [] });
  return `Kept ${lines.length} lessons${cfg.projectId ? ` and ${saved} answers (saved to the project's knowledge base)` : ''}.`;
}
