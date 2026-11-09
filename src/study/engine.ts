/**
 * Atlas study mode (NotebookLM-style) for one project's documents. Everything is
 * generated on the phone with the loaded model, and every item points back to the
 * exact source passage it came from ([1], [2] ... tap to read the passage).
 */
import { ragService } from '../services/rag';
import { runBackgroundJob } from '../services/llmJobQueue';
import { knowledgeSource } from '../services/rag/knowledgeSource';
import { ensureTextModel } from '../atlasTools/models';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildCrossword, buildWordSearch, Crossword, LearningTerm, WordSearch, normalizeLearningWord } from './learningGames';

export interface Source { n: number; doc: string; part: number; text: string; origin?: 'project' | 'library' | 'web'; url?: string }
export interface Card { q: string; a: string; src: number[] }
export interface QuizItem { q: string; options: string[]; answer: number; why: string; src: number[] }
export interface PodcastLine { host: 'A' | 'B' | 'C'; text: string }
export interface Slide { title: string; bullets: string[]; narration: string; src: number[] }

export interface StudyResult {
  kind: 'guide' | 'formulas' | 'cards' | 'quiz' | 'podcast' | 'slides' | 'answer' | 'outline' | 'crossword' | 'wordsearch' | 'match' | 'game';
  createdAt: number;
  topic: string;
  title?: string;
  sources: Source[];
  text?: string;
  cards?: Card[];
  quiz?: QuizItem[];
  podcast?: PodcastLine[];
  /** Line numbers where the second and later stories of a news briefing start (for the chime between stories). */
  storyStarts?: number[];
  hosts?: number;
  slides?: Slide[];
  learningTerms?: LearningTerm[];
  crossword?: Crossword;
  wordSearch?: WordSearch;
  /** Daily briefing: the real headlines it was written from (outlet, link, time). */
  headlines?: { title: string; source?: string; url?: string; date?: number; interest?: string }[];
  /** Estimated listening time of a podcast script, in minutes. */
  minutes?: number;
  /** Project learning game payload (kind === 'game'), see src/study/games. */
  game?: { type: string; data: any };
}

interface StudyState {
  saved: Record<string, StudyResult[]>; // by project
  add: (projectId: string, r: StudyResult) => void;
  remove: (projectId: string, createdAt: number) => void;
  update: (projectId: string, createdAt: number, patch: Partial<StudyResult>) => void;
}
function withoutProtectedProjects(saved: Record<string, StudyResult[]>): Record<string, StudyResult[]> {
  const { useProjectStore } = require('../stores/projectStore');
  const locked = new Set((useProjectStore.getState().projects as { id: string; pinVerifier?: string }[])
    .filter((p) => p.pinVerifier).map((p) => p.id));
  if (!locked.size) return saved;
  return Object.fromEntries(Object.entries(saved).filter(([pid]) => !locked.has(pid)));
}

export const useStudyStore = create<StudyState>()(
  persist(
    (set) => ({
      saved: {},
      // 150 items per project (games add many); the oldest beyond that are dropped.
      add: (pid, r) => set((s) => ({ saved: { ...s.saved, [pid]: [r, ...(s.saved[pid] || [])].slice(0, 150) } })),
      update: (pid, at, patch) => set((s) => ({ saved: { ...s.saved, [pid]: (s.saved[pid] || []).map((x) => (x.createdAt === at ? { ...x, ...patch } : x)) } })),
      remove: (pid, at) => set((s) => ({ saved: { ...s.saved, [pid]: (s.saved[pid] || []).filter((x) => x.createdAt !== at) } })),
    }),
    {
      name: 'atlas-study',
      storage: createJSONStorage(() => AsyncStorage),
      // A protected project's outputs live in its encrypted study vault, never in plain storage.
      partialize: (s) => ({ saved: withoutProtectedProjects(s.saved) }),
    },
  ),
);

const SOURCE_CHARS = 700;
/** Characters of source text that fit the loaded model's context (about 3 chars per token, minus room for the answer). */
function budget(): number {
  try {
    const { llmService } = require('../services/llm');
    const ctx = Number(llmService.getPerformanceSettings?.()?.contextLength) || 2048;
    return Math.max(1500, Math.min(12000, (ctx - 900) * 3 - 1200));
  } catch { return 3000; }
}
export const trimSources = (src: Source[]): Source[] => {
  const max = budget(); let used = 0; const out: Source[] = [];
  for (const x of src) { if (used + x.text.length > max) break; used += x.text.length; out.push(x); }
  return out.map((x, i) => ({ ...x, n: i + 1 }));
};
/** Removes markdown decoration small models like to add around the requested format. */
const tidy = (t: string) => t.replace(/\*\*|__/g, '').replace(/^\s*(?:[-*•]|\d+[.)])\s+(?=(?:Q|A|ANSWER|WHY|SRC|TITLE|SAY|[A-D])\s*[:).])/gim, '');

/** Sources for a topic (search) or, with no topic, a spread across all documents. */
export async function gatherSources(projectId: string, topic: string, share = 1, cache: { all?: any[] } = {}): Promise<Source[]> {
  let raw: { name: string; content: string; position: number }[] = [];
  if (topic.trim()) {
    const r: any = await ragService.searchProject(projectId, topic.trim());
    raw = (r?.chunks || []).slice(0, 8);
  }
  if (raw.length < 4) {
    // Read once per cache: a long episode asks for sources for every part.
    const all = (cache.all ??= knowledgeSource(projectId).getChunksByProject(projectId, 3000) as any[]);
    // Even spread: every document gets a share, evenly spaced through it.
    const byDoc = new Map<string, any[]>();
    all.forEach((c) => { if (!byDoc.has(c.name)) byDoc.set(c.name, []); byDoc.get(c.name)!.push(c); });
    const perDoc = Math.max(1, Math.floor(8 / Math.max(1, byDoc.size)));
    for (const list of byDoc.values()) {
      list.sort((a, b) => a.position - b.position);
      for (let i = 0; i < perDoc && i < list.length; i++) raw.push(list[Math.floor((i * list.length) / perDoc)]);
    }
  }
  const out: Source[] = [];
  let used = 0;
  const max = budget() * share;
  for (const c of raw) {
    const text = String(c.content).replace(/\s+/g, ' ').trim().slice(0, SOURCE_CHARS);
    if (!text || out.some((o) => o.text === text)) continue;
    if (used + text.length > max) break;
    out.push({ n: out.length + 1, doc: c.name, part: (c.position ?? 0) + 1, text });
    used += text.length;
  }
  return out;
}

export const sourceBlock = (s: Source[]) => s.map((x) => `[${x.n}] (${x.doc}, part ${x.part})\n${x.text}`).join('\n\n');
const refs = (t: string) => [...new Set([...t.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])))];

/** One grounded model call for study features (games use it too). */
export async function askModel(system: string, user: string): Promise<string> { return ask(system, user); }

async function ask(system: string, user: string): Promise<string> {
  await ensureTextModel(null);
  const { llmService } = require('../services/llm');
  return runBackgroundJob(async () => {
  const out: string = await llmService.generateResponse(
    [{ id: 's', role: 'system', content: system, timestamp: 0 }, { id: 'u', role: 'user', content: user, timestamp: 0 }],
    { disableThinking: true },
  );
  return out.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  });
}

const LINE_RE = /^\s*(?:[-*•]|\d+[.)])?\s*\**\s*(?:HOST|SPEAKER)?\s*([ABC])\**\s*[:\-–—]\s*\**\s*(.+)$/i;
export const GROUND = 'Use ONLY the numbered sources. After every fact put the source number in brackets like [2]. If the sources do not cover something, do not invent it.';

export function learningActivitiesEnabled(projectId: string): boolean {
  const project = require('../stores/projectStore').useProjectStore.getState().getProject(projectId);
  // On unless the user switched it off (older projects had no setting at all).
  return project?.allowLearningActivities !== false;
}

/** Filter small-model puzzle output against the original project source text. */
/**
 * Everyday words that occur in almost any passage. They pass the "occurs in the source" check
 * but say nothing about the study material, so they never become puzzle terms.
 */
const FILLER_TERMS = new Set(('ABOUT ABOVE AFTER AGAIN ALSO ALWAYS AMONG ANOTHER BECAUSE BEFORE BEING BELOW BETWEEN BOTH ' +
  'CERTAIN COULD DIFFERENT DURING EACH EVERY EXAMPLE EXAMPLES FIRST FOLLOWING GENERAL GOOD GREAT HOWEVER IMPORTANT ' +
  'INCLUDE INCLUDES INCLUDING INFORMATION LARGE LITTLE MANY MORE MOST MUCH MUST NEVER NUMBER OFTEN OTHER OTHERS PART ' +
  'PEOPLE PERSON PLACE POSSIBLE SECOND SEVERAL SHOULD SIMILAR SINCE SMALL SOME SOMETHING SPECIFIC STILL SUCH THAN THAT ' +
  'THEIR THEM THEN THERE THEREFORE THESE THEY THING THINGS THIS THOSE THROUGH TIME TIMES TOGETHER UNDER UNTIL USED USING ' +
  'USUALLY VARIOUS VERY WAYS WELL WERE WHAT WHEN WHERE WHICH WHILE WITH WITHIN WITHOUT WOULD YEAR YEARS').split(' '));
export const isFillerTerm = (word: string) => FILLER_TERMS.has(word.toUpperCase());

export function parseGroundedLearningTerms(raw: string, sources: Source[]): LearningTerm[] {
  const out: LearningTerm[] = [];
  const used = new Set<string>();
  for (const line of tidy(raw).split('\n')) {
    // Small models add numbering, bold or drop the SRC part; accept those variants.
    const match = line.trim().match(/^(?:[-*•]|\d+[.)])?\s*TERM\s*:\s*([^|]+?)\s*\|\s*(?:CLUE|DEFINITION)\s*:\s*(.+?)\s*(?:\|\s*SRC\s*:\s*\[?(\d+)\]?)?\s*$/i);
    if (!match) continue;
    const answer = normalizeLearningWord(match[1]);
    const clue = match[2].trim();
    if (answer.length < 3 || answer.length > 14 || used.has(answer) || clue.length < 8 || isFillerTerm(answer) ||
        clue.toUpperCase().replace(/[^A-Z]/g, '').includes(answer)) continue;
    // The word must really occur in a source passage: prefer the cited one, else any.
    const word = new RegExp('\\b' + answer + '\\b', 'i');
    const cited = sources.find(s => s.n === Number(match[3]));
    const source = cited && word.test(cited.text) ? cited : sources.find(s => word.test(s.text));
    if (!source) continue;
    used.add(answer);
    out.push({ answer, clue, src: [source.n] });
    if (out.length >= 16) break;
  }
  return out;
}

function shuffleIndexes(n: number, seed: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  let a = seed >>> 0;
  for (let i = n - 1; i > 0; i--) {
    a = (Math.imul(a ^ (a >>> 15), 2246822507) + 0x9E3779B9) >>> 0;
    const j = a % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Key terms + clues that really occur in the sources (shared by most project games). */
export async function termsFromSources(sources: Source[], topic = '', min = 3): Promise<LearningTerm[]> {
  const S = `SOURCES:\n${sourceBlock(sources)}\n\n`;
  const about = topic.trim() ? `Focus: ${topic.trim()}\n` : '';
  const raw = await ask(
    'You create educational word puzzles from document passages. Use ONLY words that actually occur in the provided sources. Do not invent facts. Make concise clues that do not reveal the term. Do not include answers longer than 14 letters.',
    `${S}${about}Extract up to 14 distinct important single-word terms and clues drawn from the sources. Use exactly one item per line in this format:\nTERM: WORD | CLUE: a short question or definition without the word | SRC: 1\nThe source number must identify a passage that literally contains the word. No introduction.`,
  );
  const terms = parseGroundedLearningTerms(raw, sources);
  if (terms.length < min) throw new Error('Not enough verifiable terms could be found in the project sources. Try more documents or a larger local model.');
  return terms;
}

export async function generate(projectId: string, kind: StudyResult['kind'], topic: string): Promise<StudyResult> {
  if (['quiz', 'podcast', 'crossword', 'wordsearch', 'match'].includes(kind) && !learningActivitiesEnabled(projectId)) {
    throw new Error('Enable Learning Activities in this project’s settings to generate quizzes, podcasts, or games.');
  }
  const sources = await gatherSources(projectId, topic);
  if (!sources.length) throw new Error('This project has no documents in its knowledge base yet.');
  const S = `SOURCES:\n${sourceBlock(sources)}\n\n`;
  const about = topic.trim() ? `Focus: ${topic.trim()}\n` : '';
  const base: StudyResult = { kind, createdAt: Date.now(), topic: topic.trim(), sources };

  if (kind === 'answer') {
    const t = await ask(`You answer questions from documents. ${GROUND} Be clear and short.`, `${S}QUESTION: ${topic}`);
    return { ...base, text: t };
  }
  if (kind === 'guide') {
    const t = await ask(`You write study guides. ${GROUND}`, `${S}${about}Write a study guide with: a 3-sentence summary, the key ideas as short bullet points, important terms with one-line definitions, and 3 questions to think about. Use markdown headings.`);
    return { ...base, text: t };
  }
  if (kind === 'formulas') {
    const t = await ask(
      `You write formula sheets for students. ${GROUND}`,
      `${S}${about}Write a formula sheet from the sources. Group it under short markdown headings by topic. For every formula, equation, rule, constant or key number the sources contain, give: the formula on its own line inside backticks, what each symbol means, when to use it, and a tiny worked example only if the sources give the numbers. Keep each entry to a few lines. If the sources contain no formulas, say that in one line at the top and list the key rules, definitions and numbers instead.`,
    );
    return { ...base, title: `Formula sheet${topic.trim() ? `: ${topic.trim()}` : ''}`, text: t };
  }
  if (kind === 'outline') {
    const t = await ask(`You make mind-map outlines. ${GROUND}`, `${S}${about}Make a mind-map style outline: one main topic, 3-6 branches, 2-4 short points under each branch (nested markdown bullets). Cite sources.`);
    return { ...base, text: t };
  }
  if (kind === 'cards') {
    const t = await ask(`You make flashcards. ${GROUND}`, `${S}${about}Make 8 flashcards. One per line, exactly this format:\nQ: question | A: short answer | SRC: number\nNothing else.`);
    const T = tidy(t);
    const srcOf = (x?: string) => refs(`[${(x || '').replace(/[[\]]/g, '').split(/[,\s]+/).filter(Boolean).join('][')}]`);
    let cards: Card[] = T.split('\n').map((l) => {
      const m = l.match(/Q:\s*(.+?)\s*\|\s*A:\s*(.+?)\s*(?:\|\s*(?:SRC|SOURCES?)\s*:\s*([\d,\s[\]]+))?[.\s]*$/i);
      return m ? { q: m[1].trim(), a: m[2].trim(), src: srcOf(m[3]) } : null;
    }).filter(Boolean) as Card[];
    if (!cards.length) {
      // Fallback: "Q: ..." and "A: ..." on separate lines.
      cards = [...T.matchAll(/Q:\s*(.+)\n+\s*A:\s*(.+?)(?:\s*\|?\s*SRC:\s*([\d,\s[\]]+))?\s*$/gim)].map((m) => ({ q: m[1].trim(), a: m[2].trim(), src: srcOf(m[3]).length ? srcOf(m[3]) : refs(m[0]) }));
    }
    if (!cards.length) throw new Error('The model did not produce flashcards in the expected format. Try again or use a bigger model.');
    return { ...base, cards };
  }
  if (kind === 'crossword' || kind === 'wordsearch' || kind === 'match') {
    const terms = await termsFromSources(sources, topic);
    if (kind === 'crossword') {
      const crossword = buildCrossword(terms);
      if (crossword.entries.length < 3) throw new Error('These project terms do not cross sufficiently for a crossword. Try another topic.');
      return { ...base, title: 'Project crossword', learningTerms: terms, crossword };
    }
    if (kind === 'wordsearch') {
      const wordSearch = buildWordSearch(terms);
      if (wordSearch.entries.length < 3) throw new Error('Not enough terms fit into the word-search grid. Try another topic.');
      return { ...base, title: 'Project word search', learningTerms: terms, wordSearch };
    }
    return { ...base, title: 'Project matching game', learningTerms: terms };
  }
  if (kind === 'quiz') {
    const t = await ask(`You write multiple-choice quizzes. ${GROUND}`, `${S}${about}Write 5 questions. For each, exactly:\nQ: question\nA) option\nB) option\nC) option\nD) option\nANSWER: letter\nWHY: one sentence\nSRC: number\n(blank line between questions)`);
    const T = tidy(t);
    // Split on each question start (tolerates blank lines between a question and its options).
    const blocks = T.split(/\n(?=\s*Q(?:uestion)?\s*\d*\s*[:.)])/i);
    const quiz: QuizItem[] = blocks.map((b) => {
      const q = b.match(/^\s*Q(?:uestion)?\s*\d*\s*[:.)]\s*(.+)/im)?.[1]?.trim();
      const opts = ['A', 'B', 'C', 'D'].map((L) => b.match(new RegExp(`^\\s*\\(?${L}\\s*[).:\\-–]\\s*(.+)$`, 'mi'))?.[1]?.trim()).filter(Boolean) as string[];
      const ans = 'ABCD'.indexOf((b.match(/ANSWER\s*[:\-]?\s*(?:option\s*)?\(?([A-D])\b/i)?.[1] || '').toUpperCase());
      // Reject partial/ambiguous options instead of accepting an answer that
      // points outside the parsed choices (common with small local models).
      if (!q || opts.length !== 4 || ans < 0 || ans >= opts.length ||
          opts.some(option => !option.trim())) return null;
      return { q, options: opts, answer: ans, why: b.match(/WHY:\s*(.+)/i)?.[1]?.trim() || '', src: refs(`[${(b.match(/SRC:\s*([\d,\s[\]]+)/i)?.[1] || '').replace(/[[\]]/g, '').split(/[,\s]+/).filter(Boolean).join('][')}]`) };
    }).filter(Boolean) as QuizItem[];
    if (!quiz.length) throw new Error('The model did not produce a quiz in the expected format. Try again or use a bigger model.');
    // Small models put the right answer first most of the time: shuffle the options.
    const shuffled = quiz.map((q, i) => {
      const order = shuffleIndexes(q.options.length, Date.now() + i);
      return { ...q, options: order.map((k) => q.options[k]), answer: order.indexOf(q.answer) };
    });
    return { ...base, quiz: shuffled };
  }
  if (kind === 'podcast') {
    const t = await ask(
      'You write short, lively two-person podcast conversations that explain documents. Facts must come only from the sources. Do not put source numbers in the dialogue.',
      `${S}${about}Write a 14-18 line conversation between two hosts: A (curious, asks questions) and B (explains). Natural, friendly, plain spoken English, no sound effects. Exactly this format, one line each:\nA: ...\nB: ...`,
    );
    const podcast: PodcastLine[] = t.split('\n').map((l) => {
      const m = l.match(LINE_RE);
      return m ? { host: (m[1].toUpperCase() === 'A' ? 'A' : 'B') as 'A' | 'B', text: m[2].replace(/\[\d+\]|\*/g, '').trim() } : null;
    }).filter(Boolean) as PodcastLine[];
    if (podcast.length < 4) throw new Error('The model did not write the conversation in the expected format. Try again.');
    return { ...base, podcast };
  }
  // slides (narrated, like a short explainer video)
  const t = await ask(`You make short explainer slideshows. ${GROUND}`, `${S}${about}Make 6 slides. For each slide, exactly:\nTITLE: ...\n- bullet\n- bullet\n- bullet\nSAY: one or two spoken sentences explaining the slide\nSRC: number\n(blank line between slides)`);
  const slides: Slide[] = tidy(t).split(/\n(?=\s*(?:#+\s*)?(?:Slide\s*\d+\s*[:.\-]?\s*)?TITLE\s*:)/i).map((b) => {
    const title = b.match(/TITLE:\s*(.+)/i)?.[1]?.trim();
    if (!title) return null;
    const bullets = b.split('\n').filter((l) => /^\s*[-*•]\s+/.test(l)).map((l) => l.replace(/^\s*[-*•]\s+/, '').trim()).slice(0, 5);
    return { title, bullets, narration: (b.match(/SAY:\s*(.+)/i)?.[1] || bullets.join('. ')).replace(/\[\d+\]/g, '').trim(), src: [...new Set([...refs(b), ...(b.match(/SRC:\s*([\d,\s]+)/i)?.[1] || '').split(/[,\s]+/).filter(Boolean).map(Number)])] };
  }).filter(Boolean) as Slide[];
  if (!slides.length) throw new Error('The model did not make slides in the expected format. Try again.');
  return { ...base, slides };
}


// ---------------------------------------------------------------- podcast episodes
export type PodcastLength = 'short' | 'medium' | 'long';
export type PodcastStyle = 'casual' | 'deep' | 'debate' | 'interview' | 'beginner' | 'news';
export interface PodcastOptions {
  prompt: string; length?: PodcastLength; minutes?: number; hosts?: 1 | 2 | 3; style: PodcastStyle; research: boolean; funFacts?: boolean; title?: string;
  /** Checked between parts: true ends the episode early and keeps what is written so far. */
  shouldStop?: () => boolean;
  /**
   * Fixed outline: one part per item, each written ONLY from its own sources (news briefings:
   * one part per real story). Skips planning, and keeps parts short when a source is thin so
   * the model does not fill gaps with invented detail.
   */
  outline?: { topic: string; sources: Source[]; always?: boolean }[];
  /** Outline mode: script lines to aim for per item, to reach the chosen length. */
  linesPerItem?: number;
  /**
   * Outline mode: spoken words the episode should reach. Items are written in order until the script really has that many
   * words (the last one written gets the goodbye), so a long outline is cut short and a thin one is not padded. Items left
   * over are simply not used; `onItemsUsed` says how many were.
   */
  targetWords?: number;
  /** The caller adds the opening greeting itself: the first part must not welcome listeners. */
  noWelcome?: boolean;
  onItemsUsed?: (count: number) => void;
  /** Outline mode: a rule every part must follow (e.g. topics never to bring up). */
  rules?: string;
  /** Outline mode: who speaks in each part (e.g. the anchor and that topic's expert). */
  castFor?: (index: number) => string | undefined;
  /** Fresh sources for one part's topic. Long episodes use it so each part draws on different passages. */
  sourcesFor?: (topic: string) => Promise<Source[]>;
}

/** Longest episode: 90 minutes (60 written parts of about 1.5 minutes each). */
export const MAX_PODCAST_MINUTES = 90;
/** Parts per planning call; a phone model plans a dozen topics reliably, not forty. */
const PLAN_BATCH = 12;
const SEGMENT_RE = (i: number) => new RegExp(`(?:SEGMENT|PART)\\s*${i}\\s*[:.)\\-–]\\s*(.+)`, 'i');

/** Number of written parts for an episode length (about 1.5 minutes of speech each). */
export const podcastParts = (minutes: number): number => Math.max(1, Math.min(MAX_PODCAST_MINUTES / 1.5, Math.round(minutes / 1.5)));

/**
 * Each written part is its own model call (sources + outline + the last lines), so an hour-long
 * episode needs the same context as a short one: about 3000 tokens. Returns a warning when the
 * loaded model's context is smaller than that.
 */
export function podcastContextWarning(): string | null {
  try {
    const { llmService } = require('../services/llm');
    const ctx = Number(llmService.getPerformanceSettings?.()?.contextLength) || 0;
    if (ctx && ctx < 3000) return `The model's context is ${ctx} tokens. Raise it to at least 4096 in the text model settings so each part can read its sources.`;
  } catch { /* no model yet */ }
  return null;
}

/** Sources for a long part must not repeat the same passages: merge new ones into the episode's list. */
export function mergeEpisodeSources(all: Source[], fresh: Source[]): { all: Source[]; part: Source[] } {
  const part: Source[] = [];
  const next = [...all];
  for (const f of fresh) {
    const known = next.find((x) => x.text === f.text);
    if (known) { part.push(known); continue; }
    const added = { ...f, n: next.length + 1 };
    next.push(added); part.push(added);
  }
  return { all: next, part };
}

const STYLE_TEXT: Record<PodcastStyle, string> = {
  casual: 'friendly and relaxed, like two friends chatting',
  deep: 'a deep dive: careful, detailed, connecting ideas',
  debate: 'a friendly debate: the hosts take different sides and weigh the evidence',
  interview: 'an interview: A is the interviewer, B is the expert guest',
  beginner: 'for complete beginners: simple words, everyday examples, no jargon',
  news: 'a friendly daily news show: story by story, each explained simply with why it matters, upbeat but accurate',
};

/** Extra research: offline library (Kiwix) first, then the web when online and not in off-grid mode. */
async function researchSources(query: string, startN: number, onStep: (m: string) => void): Promise<Source[]> {
  const out: Source[] = [];
  try {
    onStep('Researching the offline library...');
    const { searchLibrary, readArticle } = require('../atlasTools/offlineLibrary');
    const hits = await searchLibrary(query, 3);
    for (const h of hits.slice(0, 2)) {
      try {
        const a = await readArticle(h.uri, h.path, 900);
        out.push({ n: startN + out.length, doc: `${h.library}: ${a.title}`, part: 1, text: a.text.replace(/\s+/g, ' ').slice(0, 800), origin: 'library' });
      } catch { /* skip */ }
    }
  } catch { /* no library */ }
  try {
    const { offGridOn } = require('../atlasTools/offGrid');
    if (!offGridOn()) {
      onStep('Researching the web...');
      const { searchWeb } = require('../services/tools/webSearchProviders');
      const r = await searchWeb(query, (q: string) => require('../services/tools/handlers').braveSearch(q));
      for (const w of r.results.slice(0, 3)) {
        if (!w.snippet) continue;
        out.push({ n: startN + out.length, doc: w.title, part: 1, text: w.snippet.slice(0, 600), origin: 'web', url: w.url });
      }
    }
  } catch { /* offline */ }
  return out;
}

/**
 * Makes a podcast episode in steps (plan, then each segment) so it can be longer than the
 * model's memory: from the project sources, an optional prompt and optional extra research.
 */
export async function generatePodcast(projectId: string, opts: PodcastOptions, onStep: (m: string) => void = () => undefined): Promise<StudyResult> {
  if (!learningActivitiesEnabled(projectId)) throw new Error('Enable Learning Activities in Project Settings before generating a podcast.');
  onStep('Reading your sources...');
  // With extra research on, leave room in the model's memory for the research sources.
  let sources = await gatherSources(projectId, opts.prompt, opts.research ? 0.6 : 1);
  if (opts.research) {
    const extra = await researchSources(opts.prompt || sources.map((x) => x.doc).slice(0, 2).join(' '), sources.length + 1, onStep);
    sources = trimSources([...sources, ...extra]);
  }
  if (!sources.length) throw new Error('No sources: add documents to this project, or turn on extra research.');
  const chunkCache: { all?: any[] } = {};
  return writeEpisode(sources, { ...opts, sourcesFor: opts.sourcesFor ?? ((topic) => gatherSources(projectId, topic, 1, chunkCache)) }, onStep);
}

/** Writes the episode script from ready-made sources (projects, the daily briefing, ...). */
const parseLines = (t: string, hosts: number): PodcastLine[] => t.split('\n').map((l) => {
  const m = l.match(LINE_RE);
  if (!m) return null;
  const h = m[1].toUpperCase() as 'A' | 'B' | 'C';
  const text = m[2].replace(/\[\d+\]|\*/g, '').trim();
  return text ? { host: hosts === 1 ? 'A' : hosts === 2 && h === 'C' ? 'B' : h, text } : null;
}).filter(Boolean) as PodcastLine[];

/** Lines a part may have: about one per 180 characters of source, 3 to 8. */
export const outlineLines = (sources: Source[]) =>
  Math.max(3, Math.min(8, Math.round(sources.reduce((n, x) => n + x.text.length, 0) / 180)));

const normal = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = (t: string) => new Set(normal(t).split(' ').filter((w) => w.length > 3));
/** Drops lines that say again what an earlier line already said (same words, or nearly): the model sometimes pads. */
export function withoutRepeats(fresh: PodcastLine[], before: PodcastLine[]): PodcastLine[] {
  const seen = before.map((l) => ({ n: normal(l.text), w: words(l.text) }));
  const out: PodcastLine[] = [];
  for (const l of fresh) {
    const n = normal(l.text), w = words(l.text);
    const same = seen.some((s) => {
      if (s.n === n) return true;
      if (w.size < 5 || s.w.size < 5) return false;
      let shared = 0; w.forEach((x) => { if (s.w.has(x)) shared++; });
      return shared / Math.min(w.size, s.w.size) >= 0.8;
    });
    if (same) continue;
    seen.push({ n, w }); out.push(l);
  }
  return out;
}

async function writeOutlinedEpisode(
  outline: { topic: string; sources: Source[]; always?: boolean }[], opts: PodcastOptions,
  cfg: { cast: string; fmt: string; style: string; hosts: number }, onStep: (m: string) => void,
): Promise<StudyResult> {
  const title = opts.title || opts.prompt || 'Episode';
  const lines: PodcastLine[] = [];
  const all: Source[] = [];
  const wordCount = () => lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
  let used = 0;
  let finished = false;
  const storyStarts: number[] = [];
  for (let i = 0; i < outline.length; i++) {
    if (opts.shouldStop?.() && lines.length >= 4) break;
    // Once the length is reached only the items marked `always` (a fun fact) are still written.
    if (finished && !outline[i].always) continue;
    onStep(`Writing part ${i + 1} of ${outline.length}: ${outline[i].topic.slice(0, 60)}...`);
    const part = outline[i];
    part.sources.forEach((x) => all.push(x));
    // Never more lines than the source can fill (no padding), but as many as the chosen length needs.
    const n = opts.linesPerItem ? Math.min(opts.linesPerItem, Math.max(4, Math.round(part.sources.reduce((k, x) => k + x.text.length, 0) / 80))) : outlineLines(part.sources);
    // With a word target, this is the last item once it should bring the script to the target (or when none are left).
    const reaches = !!opts.targetWords && wordCount() + n * 12 >= opts.targetWords;
    const alwaysAfter = outline.slice(i + 1).some((o) => o.always);
    const last = i === outline.length - 1 || ((reaches || finished) && !alwaysAfter);
    const where = last && i === 0 ? `This is the WHOLE episode: ${opts.noWelcome ? 'cover it' : 'welcome listeners, cover it'}, then say goodbye.`
      : i === 0 ? (opts.noWelcome ? 'This is the FIRST item: a greeting was already said, so start straight into it.' : 'This is the START: A welcomes listeners and names the episode, then covers this item.')
        : last ? 'This is the LAST item: cover it, then a one-line wrap-up and goodbye.'
          : 'Move on to this item with a short natural transition.';
    const recap = lines.slice(-3).map((l) => `${l.host}: ${l.text}`).join('\n');
    const covered = outline.slice(0, i).map((o) => `- ${o.topic.slice(0, 90)}`).join('\n');
    // With a length to reach, ask for about n lines (the hosts may explain why the story
    // matters, from the source); otherwise at most n.
    const howMany = opts.linesPerItem ? `Write about ${n} lines (no fewer than ${Math.max(3, n - 2)}), each 1-2 sentences; never repeat a line already said` : `Write at most ${n} lines (each 1-2 sentences)`;
    const cast = opts.castFor?.(i) ?? cfg.cast;
    const t = await ask(
      'You write natural spoken scripts from sources. Say ONLY what the sources say: never add names, numbers, dates, places or quotes that are not in them. If the source gives few details, the hosts may say why it matters, using only what the source says. Never mention source numbers.',
      `SOURCES:\n${sourceBlock(part.sources)}\n\nEpisode: "${title}". Style: ${cfg.style}. Cast: ${cast}.\nThis item: ${part.topic}\n${where}\n${recap ? `Last lines so far:\n${recap}\n` : ''}${covered ? `Already covered (do not repeat or retell these):\n${covered}\n` : ''}${opts.rules ? `${opts.rules}\n` : ''}${howMany}, exactly in this format:\n${cfg.fmt}`,
    );
    const written = withoutRepeats(parseLines(t, cfg.hosts).slice(0, n + 2), lines);
    if (lines.length && written.length) storyStarts.push(lines.length);
    lines.push(...written);
    if (!part.always) used++;
    if (reaches) finished = true;
    if (last) break;
  }
  opts.onItemsUsed?.(used);
  if (lines.length < 2) throw new Error('The model did not write the script in the expected format. Try again or use a bigger model.');
  return { kind: 'podcast', createdAt: Date.now(), topic: opts.prompt, title, sources: all.slice(0, 60), podcast: lines, hosts: cfg.hosts, storyStarts };
}

export async function writeEpisode(sources: Source[], opts: PodcastOptions, onStep: (m: string) => void = () => undefined): Promise<StudyResult> {
  const S = `SOURCES:\n${sourceBlock(sources)}\n\n`;
  // About 1.5 minutes of speech per written part (10 lines of ~25 words).
  const minutes = opts.minutes ?? (opts.length === 'short' ? 3 : opts.length === 'long' ? 10 : 6);
  const nSeg = podcastParts(minutes);
  const hosts = opts.hosts ?? 2;
  const cast = hosts === 1
    ? 'ONE narrator (A) speaking alone, like a solo podcast'
    : hosts === 3
      ? 'THREE hosts: A (curious host), B (explains), C (adds practical tips and examples)'
      : 'TWO hosts: A (curious, asks questions) and B (explains)';
  const fmt = hosts === 1 ? 'A: ...' : hosts === 3 ? 'A: ...\nB: ...\nC: ...' : 'A: ...\nB: ...';
  const style = STYLE_TEXT[opts.style];

  if (opts.outline?.length) return writeOutlinedEpisode(opts.outline, opts, { cast, fmt, style, hosts }, onStep);
  onStep('Planning the episode...');
  const ask0 = opts.prompt ? `The listener asked for: ${opts.prompt}\n` : 'Pick the most interesting angle in these sources yourself.\n';
  // Short episodes are planned in one call. Long ones are planned a dozen parts at a time, each
  // call seeing the parts so far, so a 60-minute episode has a real outline instead of repeats.
  let title = opts.title || '';
  const topics: string[] = [];
  for (let from = 1; from <= nSeg; from += PLAN_BATCH) {
    const to = Math.min(nSeg, from + PLAN_BATCH - 1);
    const batchList = Array.from({ length: to - from + 1 }, (_, i) => `SEGMENT ${from + i}: one-line topic`).join('\n');
    const so_far = topics.length ? `Parts planned so far (do not repeat them):\n${topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n` : '';
    const ending = to === nSeg ? (nSeg > 1 ? `The last part (${nSeg}) is the wrap-up with key takeaways.\n` : '') : 'More parts follow after these.\n';
    const plan = await ask(
      'You plan podcast episodes based only on the given sources.',
      `${S}${ask0}Style: ${style}. Length: about ${minutes} minutes, in ${nSeg} parts.\n${so_far}${ending}Reply exactly:\n${from === 1 ? 'TITLE: catchy episode title\n' : ''}${batchList}`,
    );
    const P = plan.replace(/\*\*|__/g, '');
    if (from === 1 && !title) title = (P.match(/TITLE\s*:\s*(.+)/i)?.[1] || opts.prompt || 'Episode').replace(/["*]/g, '').trim();
    for (let i = from; i <= to; i++) {
      const topic = P.match(SEGMENT_RE(i))?.[1]?.replace(/["*]/g, '').trim();
      if (topic) topics.push(topic);
    }
    if (topics.length < to) {
      const known = [...topics];
      while (topics.length < to) topics.push(topics.length === nSeg - 1 && nSeg > 1 ? 'key takeaways and wrap-up' : `more about ${known[topics.length % Math.max(1, known.length)] || opts.prompt || 'the topic'}`);
    }
  }
  if (!title) title = (opts.prompt || 'Episode').trim();
  if (!topics.length) topics.push(opts.prompt || 'the main ideas');

  const lines: PodcastLine[] = [];
  const parse = (t: string) => parseLines(t, hosts);

  let episodeSources = sources;
  let stoppedEarly = false;
  for (let i = 0; i < topics.length; i++) {
    if (opts.shouldStop?.() && lines.length >= 4) { stoppedEarly = true; break; } // keep what is written
    onStep(`Writing part ${i + 1} of ${topics.length}...`);
    // Long episodes: each part reads passages found for its own topic.
    let partSources = sources;
    if (opts.sourcesFor && topics.length > PLAN_BATCH / 2) {
      try {
        const merged = mergeEpisodeSources(episodeSources, await opts.sourcesFor(topics[i]));
        episodeSources = merged.all;
        if (merged.part.length) partSources = merged.part;
      } catch { /* keep the base sources */ }
    }
    const PS = `SOURCES:\n${sourceBlock(partSources)}\n\n`;
    const outline = topics.length > 3 ? `Episode outline (for context, write only the part below):\n${topics.map((t, k) => `${k + 1}. ${t}`).join('\n')}\n` : '';
    const recap = lines.slice(-4).map((l) => `${l.host}: ${l.text}`).join('\n');
    const where = topics.length === 1 ? 'This is the WHOLE episode: A welcomes listeners and introduces the title, the topic is covered, then a short wrap-up and goodbye.' : i === 0 ? 'This is the START: A welcomes listeners and introduces the episode title.' : i === topics.length - 1 ? 'This is the LAST part: finish the topic, then wrap up with a short summary and goodbye.' : 'This is the MIDDLE: continue naturally from the last lines.';
    const t = await ask(
      'You write natural podcast scripts. Facts must come only from the sources. Never mention source numbers in the script.',
      `${PS}Episode: "${title}". Style: ${style}. Cast: ${cast}.\n${outline}This part is about: ${topics[i]}\n${where}\n${opts.funFacts ? 'End this part with one short fun fact related to it, introduced as a fun fact. Use only facts you are sure are true.\n' : ''}${recap ? `Last lines so far:\n${recap}\n` : ''}Write about 10 lines (each 1-3 sentences), one line each, exactly in this format:\n${fmt}`,
    );
    lines.push(...parse(t));
  }
  if (stoppedEarly) {
    // Ended by the person: close the episode properly instead of cutting off mid-topic.
    onStep('Writing the ending...');
    try {
      const recap = lines.slice(-4).map((l) => `${l.host}: ${l.text}`).join('\n');
      const t = await ask(
        'You write natural podcast scripts. Never mention source numbers in the script.',
        `Episode: "${title}". Style: ${style}. Cast: ${cast}.\nThe episode ends here. Write a short wrap-up in about 4 lines: a one-sentence summary of what was covered, then a goodbye.\nLast lines so far:\n${recap}\nExactly this format:\n${fmt}`,
      );
      lines.push(...parse(t));
    } catch { /* the episode is still complete enough without it */ }
  }
  if (lines.length < 4) throw new Error('The model did not write the conversation in the expected format. Try again or use a bigger model.');
  return { kind: 'podcast', createdAt: Date.now(), topic: opts.prompt, title, sources: episodeSources.slice(0, 60), podcast: lines, hosts };
}
