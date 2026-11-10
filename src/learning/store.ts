import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { localUniqueId } from '../utils/uniqueId';

export type LearnEventKind = 'bank' | 'appeal' | 'question' | 'report' | 'judge' | 'manager' | 'info' | 'error';
export interface LearnEvent { id: string; at: number; kind: LearnEventKind; agentId: string; title: string; body: string }

/** keep = what it learns is saved into the agent (lessons + knowledge). session = practice only, nothing changes unless you tap "Keep". */
export type LearnMode = 'keep' | 'session';

export interface LearnConfig {
  /** The task / subject the agent should become good at. */
  topic: string;
  /** Project whose knowledge base is used for research (and where learned notes are saved in keep mode). */
  projectId: string;
  mode: LearnMode;
  /** How many questions the learner proposes per round. */
  bankSize: number;
  reportsPerJudge: number;
  judgesPerManager: number;
  /** Research in the offline library (Kiwix) too. */
  useLibrary: boolean;
  /** Research on the web too (never in off-grid mode). */
  useWeb: boolean;
  /** Keep making new question rounds after the bank is done (keep mode). */
  continuous: boolean;
  learnerModelId?: string;
  judgeModelId?: string;
  managerModelId?: string;
}

export type BankStatus = 'pending' | 'approved' | 'rejected' | 'answered' | 'failed' | 'dropped';
export interface BankItem {
  id: string;
  q: string;
  status: BankStatus;
  /** Judge's reason (rejection or failed report). */
  reason?: string;
  /** Learner already argued against a rejection. */
  appealed?: boolean;
  /** Report attempts so far. */
  tries: number;
  /** Judge feedback for a redo. */
  feedback?: string;
  round: number;
}

export interface ReportSource { n: number; title: string; kind: 'project' | 'library' | 'web'; url?: string }

/** A report the learner wrote, kept in full with what the judge said about it, so it can be read. */
export interface LearnReport {
  id: string;
  itemId: string;
  q: string;
  text: string;
  sources: string;
  /** The numbered sources the report was written from; [1], [2]... in its text refer to these. */
  sourceList?: ReportSource[];
  at: number;
  /** waiting = not judged yet. */
  status: 'waiting' | 'pass' | 'fail';
  score?: number;
  /** The judge's reason (why it failed, or why it passed). */
  why?: string;
}

export interface PendingReport { itemId: string; q: string; report: string; sources: string }
export interface LearnedNote { q: string; answer: string; at: number; score?: number }

export interface PerAgent {
  round: number;
  bank: BankItem[];
  pendingReports: PendingReport[];
  /** Every report written (newest first, up to 100), in full. */
  reportLog?: LearnReport[];
  reportsSinceJudge: number;
  judgesSinceManager: number;
  totalReports: number;
  /** Manager's steering note for learner and judge. */
  direction: string;
  /** Manager's note about how the judge is judging. */
  judgeNote: string;
  /** Judge findings waiting for the manager. */
  pendingFindings: string[];
  /** Average judge score per judge turn. */
  scores: number[];
  /** Judge-approved answers (what it has learned). */
  notes: LearnedNote[];
  /** Lessons gathered in session mode (not yet given to the agent). */
  sessionLessons: string;
  /** Last manager verdict: on track or drifting. */
  onTrack: boolean | null;
  /** Lessons kept when learning without an agent (an agent keeps its own). */
  lessons: string;
}

export const blankState = (): PerAgent => ({
  round: 0, bank: [], pendingReports: [], reportLog: [], reportsSinceJudge: 0, judgesSinceManager: 0, totalReports: 0,
  direction: '', judgeNote: '', pendingFindings: [], scores: [], notes: [], sessionLessons: '', onTrack: null, lessons: '',
});

export const defaultLearnConfig = (): LearnConfig => ({
  topic: '', projectId: '', mode: 'keep', bankSize: 10, reportsPerJudge: 3, judgesPerManager: 2,
  useLibrary: true, useWeb: false, continuous: true,
});

/** A subject the AI studies on its own: its own topic, question bank, reports and lessons. */
export interface Expert { id: string; name: string }

interface LearningState {
  /** Subjects beyond the general one (taxes, law, psychology...). Each keeps its own learning, so one expert never blurs into another. */
  experts: Expert[];
  addExpert: (name: string) => string;
  removeExpert: (id: string) => void;
  config: Record<string, LearnConfig>;
  state: Record<string, PerAgent>;
  events: LearnEvent[];
  getConfig: (agentId: string) => LearnConfig;
  setConfig: (agentId: string, c: Partial<LearnConfig>) => void;
  get: (agentId: string) => PerAgent;
  patch: (agentId: string, p: Partial<PerAgent>) => void;
  updateItem: (agentId: string, itemId: string, p: Partial<BankItem>) => void;
  addItems: (agentId: string, items: BankItem[]) => void;
  log: (e: Omit<LearnEvent, 'id' | 'at'>) => void;
  clearAgent: (agentId: string) => void;
}

export const useLearningStore = create<LearningState>()(
  persist(
    (set, getS) => ({
      experts: [],
      addExpert: (name) => {
        const base = name.trim().slice(0, 40) || 'Expert';
        const id = `expert-${base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x'}-${localUniqueId('e').slice(-4)}`;
        set((s) => ({ experts: [...s.experts, { id, name: base }] }));
        return id;
      },
      removeExpert: (id) => set((s) => {
        const { [id]: _c, ...config } = s.config;
        const { [id]: _s, ...state } = s.state;
        return { experts: s.experts.filter((e) => e.id !== id), config, state, events: s.events.filter((e) => e.agentId !== id) };
      }),
      config: {},
      state: {},
      events: [],
      getConfig: (id) => ({ ...defaultLearnConfig(), ...(getS().config[id] || {}) }),
      setConfig: (id, c) => set((s) => ({ config: { ...s.config, [id]: { ...defaultLearnConfig(), ...(s.config[id] || {}), ...c } } })),
      get: (id) => ({ ...blankState(), ...(getS().state[id] || {}) }),
      patch: (id, p) => set((s) => ({ state: { ...s.state, [id]: { ...blankState(), ...(s.state[id] || {}), ...p } } })),
      updateItem: (id, itemId, p) => set((s) => {
        const cur = { ...blankState(), ...(s.state[id] || {}) };
        return { state: { ...s.state, [id]: { ...cur, bank: cur.bank.map((b) => (b.id === itemId ? { ...b, ...p } : b)) } } };
      }),
      addItems: (id, items) => set((s) => {
        const cur = { ...blankState(), ...(s.state[id] || {}) };
        return { state: { ...s.state, [id]: { ...cur, bank: [...cur.bank, ...items] } } };
      }),
      log: (e) =>
        set((s) => ({
          events: [{ ...e, id: localUniqueId('event'), at: Date.now() }, ...s.events].slice(0, 400),
        })),
      clearAgent: (id) =>
        set((s) => ({
          state: { ...s.state, [id]: blankState() },
          events: s.events.filter((e) => e.agentId !== id),
        })),
    }),
    {
      name: 'atlas-learning',
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      // v1 kept a different shape: start the per-agent progress fresh, keep the settings.
      migrate: (persisted: any, version: number) => {
        if (!persisted) return persisted;
        if (version < 2) return { ...persisted, state: {}, events: [] };
        return persisted;
      },
    },
  ),
);

export const newItem = (q: string, round: number, status: BankStatus = 'pending'): BankItem => ({
  id: localUniqueId('item'), q: q.trim(), status, tries: 0, round,
});
