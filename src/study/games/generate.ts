/**
 * Project learning games: every game is built from the selected project's own
 * documents (the same grounded sources Study uses), and every item cites the
 * passage it came from. The model writes JSON once; play needs no model, except
 * the tutor-style games that talk with you (Feynman, Socratic tutor, levels,
 * mnemonics).
 */
import { askModel, gatherSources, GROUND, sourceBlock, termsFromSources, useStudyStore, type Source, type StudyResult } from '../engine';
import type { LearningTerm } from '../learningGames';
import { buildCloze, buildFixItems, buildPairs, shuffle, type ClozeItem, type MapEdge, type MapNode } from './logic';
import { parseJsonLoose, srcList, str } from './json';
import { useStudyProgress } from '../progress';
import { runBackgroundJob } from '../../services/llmJobQueue';

export type GameType =
  | 'review' | 'pairs' | 'hangman' | 'cloze' | 'timeline' | 'sort' | 'truefalse' | 'jeopardy'
  | 'boss' | 'feynman' | 'tutor' | 'levels' | 'palace' | 'mnemonic' | 'conceptmap' | 'daily'
  | 'exam' | 'podcastquiz' | 'scramble' | 'ladder' | 'mistake';

export interface GameInfo { type: GameType; label: string; icon: string; desc: string; usesModel: 'once' | 'live' | 'none' }

/** The project games shown on the Study screen (crossword, word search and matching are listed separately). */
export const PROJECT_GAMES: GameInfo[] = [
  { type: 'review', label: 'Review due cards', icon: 'repeat', desc: 'Spaced repetition of everything you studied', usesModel: 'none' },
  { type: 'daily', label: 'Daily challenge', icon: 'sun', desc: '3 minutes, keeps your streak', usesModel: 'none' },
  { type: 'pairs', label: 'Memory pairs', icon: 'copy', desc: 'Flip cards to match terms and clues', usesModel: 'once' },
  { type: 'hangman', label: 'Hangman & Term guess', icon: 'type', desc: 'Guess the term from its clue', usesModel: 'once' },
  { type: 'cloze', label: 'Fill the blanks', icon: 'edit-3', desc: 'Your own sentences with key words missing', usesModel: 'once' },
  { type: 'truefalse', label: 'True or false', icon: 'check-circle', desc: '60-second speed round', usesModel: 'once' },
  { type: 'timeline', label: 'Timeline / steps', icon: 'list', desc: 'Put events or steps in order', usesModel: 'once' },
  { type: 'sort', label: 'Category sort', icon: 'inbox', desc: 'Sort items into the right group', usesModel: 'once' },
  { type: 'jeopardy', label: 'Quiz board', icon: 'award', desc: 'Jeopardy-style, 1-4 players', usesModel: 'once' },
  { type: 'boss', label: 'Boss battle', icon: 'shield', desc: 'Beat the topic with right answers', usesModel: 'once' },
  { type: 'exam', label: 'Exam simulator', icon: 'clock', desc: 'Timed mixed test with a report', usesModel: 'once' },
  { type: 'conceptmap', label: 'Concept map', icon: 'share-2', desc: 'How the ideas connect', usesModel: 'once' },
  { type: 'palace', label: 'Memory palace', icon: 'home', desc: 'Remember terms room by room', usesModel: 'once' },
  { type: 'feynman', label: 'Teach it back', icon: 'mic', desc: 'Explain it; the AI checks you', usesModel: 'live' },
  { type: 'tutor', label: 'Socratic tutor', icon: 'help-circle', desc: 'Guided questions, no spoilers', usesModel: 'live' },
  { type: 'levels', label: 'Explain at my level', icon: 'sliders', desc: 'Age 5 up to expert', usesModel: 'live' },
  { type: 'mnemonic', label: 'Mnemonic maker', icon: 'zap', desc: 'Acronyms, rhymes and stories', usesModel: 'live' },
  { type: 'scramble', label: 'Word scramble', icon: 'shuffle', desc: 'Unscramble the key terms, with a hint if you are stuck', usesModel: 'once' },
  { type: 'ladder', label: 'Prize ladder', icon: 'trending-up', desc: '10 questions, 3 lifelines, safe spots on the way up', usesModel: 'once' },
  { type: 'mistake', label: 'Fix the mistake', icon: 'tool', desc: 'Pick the correction that makes a false statement true', usesModel: 'once' },
  { type: 'podcastquiz', label: 'Podcast quiz', icon: 'headphones', desc: 'Questions about your last episode', usesModel: 'once' },
];

// ----------------------------------------------------------------- data shapes
export interface McQuestion { q: string; options: string[]; answer: number; why: string; src: number[]; difficulty?: number; line?: number }
export interface Statement { text: string; isTrue: boolean; fix: string; src: number[] }
export interface OrderItem { text: string; order: number; label: string; src: number[] }
export interface SortData { buckets: string[]; items: { text: string; bucket: number; why: string; src: number[] }[] }
export interface JeopardyCategory { name: string; clues: { value: number; clue: string; answer: string; src: number[] }[] }
export interface PalaceStation { room: string; term: string; image: string; src: number[] }
export interface ConceptMap { nodes: MapNode[]; edges: (MapEdge & { src: number[] })[] }

const ROOMS = ['Front door', 'Hallway', 'Living room', 'Kitchen', 'Stairs', 'Bedroom', 'Bathroom', 'Garden'];
const JSON_ONLY = 'Reply with JSON only. No explanation before or after it.';

async function sourcesOrThrow(projectId: string, topic: string): Promise<Source[]> {
  const sources = await gatherSources(projectId, topic);
  if (!sources.length) throw new Error('This project has no documents in its knowledge base yet. Add documents first.');
  return sources;
}

async function askJson<T>(system: string, user: string): Promise<T> {
  const first = await askModel(`${system} ${JSON_ONLY}`, user);
  const parsed = parseJsonLoose<T>(first);
  if (parsed) return parsed;
  const retry = await askModel(`${system} ${JSON_ONLY}`, `${user}\n\nYour last reply was not valid JSON. Reply again with ONLY the JSON.`);
  const again = parseJsonLoose<T>(retry);
  if (!again) throw new Error('The model did not return the game data in the expected format. Try again or use a bigger model.');
  return again;
}

const nums = (sources: Source[]) => sources.map((s) => s.n);

/** Multiple-choice questions grounded in the sources, with shuffled options. */
export async function mcQuestions(sources: Source[], count: number, topic: string, extra = ''): Promise<McQuestion[]> {
  const raw = await askJson<any>(
    `You write multiple-choice questions from documents. ${GROUND}`,
    `SOURCES:\n${sourceBlock(sources)}\n\n${topic ? `Focus: ${topic}\n` : ''}Write ${count} questions. Mix easy, medium and hard (difficulty 1-3). ${extra}\nJSON: {"questions":[{"q":"","options":["right answer","wrong","wrong","wrong"],"answer":0,"why":"one sentence","src":[1],"difficulty":1}]}`,
  );
  const list: any[] = Array.isArray(raw) ? raw : raw?.questions ?? [];
  const out: McQuestion[] = [];
  for (const [i, x] of list.entries()) {
    const options: string[] = Array.isArray(x?.options) ? x.options.map((o: unknown) => str(o, 160)).filter(Boolean) : [];
    const answer = Number(x?.answer);
    if (!str(x?.q) || options.length < 3 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
    // Models usually put the right answer first: shuffle and remap.
    const order = shuffle(options.map((_, k) => k), Date.now() + i);
    out.push({
      q: str(x.q), options: order.map((k) => options[k]), answer: order.indexOf(answer),
      why: str(x.why), src: srcList(x.src, nums(sources)),
      difficulty: Math.min(3, Math.max(1, Number(x.difficulty) || 2)),
      line: Number.isInteger(Number(x.line)) ? Number(x.line) : undefined,
    });
  }
  if (out.length < Math.min(3, count)) throw new Error('The model did not write enough usable questions. Try again or use a bigger model.');
  return out;
}

export async function statements(sources: Source[], count: number, topic: string): Promise<Statement[]> {
  const raw = await askJson<any>(
    `You write true/false statements from documents. ${GROUND} Make about half false by changing exactly one fact.`,
    `SOURCES:\n${sourceBlock(sources)}\n\n${topic ? `Focus: ${topic}\n` : ''}Write ${count} statements.\nJSON: {"statements":[{"text":"","true":false,"fix":"the correct fact","src":[1]}]}`,
  );
  const list: any[] = Array.isArray(raw) ? raw : raw?.statements ?? [];
  const out = list.map((x) => ({
    text: str(x?.text, 220), isTrue: x?.true === true || x?.true === 'true' || x?.isTrue === true,
    fix: str(x?.fix, 220), src: srcList(x?.src, nums(sources)),
  })).filter((x) => x.text.length > 8);
  if (out.length < 4) throw new Error('The model did not write enough statements. Try again.');
  return out;
}

async function orderItems(sources: Source[], topic: string): Promise<{ kind: string; items: OrderItem[] }> {
  const raw = await askJson<any>(
    `You make ordering exercises from documents: either dated events or the steps of a procedure. ${GROUND}`,
    `SOURCES:\n${sourceBlock(sources)}\n\n${topic ? `Focus: ${topic}\n` : ''}Pick 5-8 events with dates, OR 5-8 steps of one procedure, that the sources put in a clear order.\nJSON: {"kind":"dates or steps","title":"what is being ordered","items":[{"text":"","order":1,"label":"1969 or Step 1","src":[1]}]}`,
  );
  const items: OrderItem[] = (raw?.items ?? []).map((x: any, i: number) => ({
    text: str(x?.text, 160), order: Number(x?.order) || i + 1, label: str(x?.label, 30), src: srcList(x?.src, nums(sources)),
  })).filter((x: OrderItem) => x.text);
  if (items.length < 4) throw new Error('The sources did not give a clear order. Try a topic with steps or dates.');
  items.sort((a, b) => a.order - b.order).forEach((x, i) => { x.order = i + 1; });
  return { kind: raw?.kind === 'dates' ? 'dates' : 'steps', items };
}

async function sortData(sources: Source[], topic: string): Promise<SortData> {
  const raw = await askJson<any>(
    `You make category-sorting exercises from documents. ${GROUND}`,
    `SOURCES:\n${sourceBlock(sources)}\n\n${topic ? `Focus: ${topic}\n` : ''}Choose 2-4 categories the sources clearly distinguish and 8-14 items that each belong to exactly one.\nJSON: {"buckets":["Category A","Category B"],"items":[{"text":"","bucket":0,"why":"one sentence","src":[1]}]}`,
  );
  const buckets: string[] = (raw?.buckets ?? []).map((b: unknown) => str(b, 40)).filter(Boolean).slice(0, 4);
  const items = (raw?.items ?? []).map((x: any) => ({
    text: str(x?.text, 120), bucket: Number(x?.bucket), why: str(x?.why), src: srcList(x?.src, nums(sources)),
  })).filter((x: any) => x.text && Number.isInteger(x.bucket) && x.bucket >= 0 && x.bucket < buckets.length);
  if (buckets.length < 2 || items.length < 6) throw new Error('The model did not make a usable sorting game. Try another topic.');
  return { buckets, items };
}

async function jeopardyBoard(sources: Source[], topic: string, onStep: (m: string) => void): Promise<JeopardyCategory[]> {
  onStep('Choosing categories...');
  const cats = await askJson<any>(
    `You pick quiz categories from documents. ${GROUND}`,
    `SOURCES:\n${sourceBlock(sources)}\n\n${topic ? `Focus: ${topic}\n` : ''}Name 4 short quiz categories (2-3 words each) that these sources cover well.\nJSON: {"categories":["",""]}`,
  );
  const names: string[] = (cats?.categories ?? cats ?? []).map((c: unknown) => str(c, 30)).filter(Boolean).slice(0, 4);
  if (names.length < 2) throw new Error('The model did not choose categories. Try again.');
  const board: JeopardyCategory[] = [];
  // One small call per category keeps each answer inside a phone model's context.
  for (const [i, name] of names.entries()) {
    onStep(`Writing clues ${i + 1} of ${names.length}...`);
    try {
      const raw = await askJson<any>(
        `You write quiz-show clues from documents. ${GROUND}`,
        `SOURCES:\n${sourceBlock(sources)}\n\nCategory: ${name}\nWrite 3 clues: easy (100), medium (200), hard (300). Answers are 1-4 words.\nJSON: {"clues":[{"value":100,"clue":"","answer":"","src":[1]}]}`,
      );
      const clues = (raw?.clues ?? []).map((x: any, k: number) => ({
        value: [100, 200, 300][k] ?? 100, clue: str(x?.clue, 200), answer: str(x?.answer, 60), src: srcList(x?.src, nums(sources)),
      })).filter((x: any) => x.clue && x.answer).slice(0, 3);
      if (clues.length) board.push({ name, clues });
    } catch { /* skip a failed category */ }
  }
  if (board.length < 2) throw new Error('Not enough quiz-board clues were written. Try again.');
  return board;
}

async function palace(sources: Source[], terms: LearningTerm[]): Promise<PalaceStation[]> {
  const chosen = terms.slice(0, ROOMS.length);
  const raw = await askJson<any>(
    'You build memory palaces: one vivid, funny, concrete image per term that links the room and the meaning.',
    `Rooms in order: ${ROOMS.slice(0, chosen.length).join(', ')}.\nTerms with meanings:\n${chosen.map((t) => `${t.answer}: ${t.clue}`).join('\n')}\nGive one image sentence per term, same order.\nJSON: {"stations":[{"room":"","term":"","image":"one vivid sentence"}]}`,
  );
  const list: any[] = raw?.stations ?? [];
  return chosen.map((t, i) => ({
    room: ROOMS[i], term: t.answer,
    image: str(list[i]?.image, 220) || `Picture "${t.answer}" in the ${ROOMS[i].toLowerCase()}: ${t.clue}`,
    src: t.src,
  }));
}

async function conceptMap(sources: Source[], topic: string): Promise<ConceptMap> {
  const raw = await askJson<any>(
    `You draw concept maps from documents. ${GROUND}`,
    `SOURCES:\n${sourceBlock(sources)}\n\n${topic ? `Focus: ${topic}\n` : ''}Pick 6-10 key ideas (1-3 words) and 6-14 labelled links between them (labels like "causes", "part of", "prevents", "needs").\nJSON: {"nodes":[{"id":"n1","label":""}],"edges":[{"from":"n1","to":"n2","label":"causes","src":[1]}]}`,
  );
  const nodes: MapNode[] = (raw?.nodes ?? []).map((n: any, i: number) => ({ id: str(n?.id, 20) || `n${i + 1}`, label: str(n?.label, 32) }))
    .filter((n: MapNode) => n.label).slice(0, 12);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (raw?.edges ?? []).map((e: any) => ({ from: str(e?.from, 20), to: str(e?.to, 20), label: str(e?.label, 24), src: srcList(e?.src, nums(sources)) }))
    .filter((e: any) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to).slice(0, 18);
  if (nodes.length < 4 || edges.length < 3) throw new Error('The model did not draw a usable concept map. Try another topic.');
  return { nodes, edges };
}

/** Puts saved flashcards and game terms of this project into spaced repetition. */
export function seedReviewItems(projectId: string): number {
  const saved = useStudyStore.getState().saved[projectId] || [];
  const progress = useStudyProgress.getState();
  let added = 0;
  for (const r of saved) {
    for (const c of r.cards ?? []) { if (progress.seed(projectId, { prompt: c.q, answer: c.a, src: c.src })) added++; }
    for (const t of r.learningTerms ?? []) { if (progress.seed(projectId, { prompt: t.clue, answer: t.answer, src: t.src })) added++; }
    if (r.kind === 'game' && Array.isArray(r.game?.data?.terms)) {
      for (const t of r.game!.data.terms as LearningTerm[]) { if (progress.seed(projectId, { prompt: t.clue, answer: t.answer, src: t.src })) added++; }
    }
  }
  return added;
}

/** Latest saved podcast of this project, for the podcast quiz. */
function latestPodcast(projectId: string): StudyResult | undefined {
  return (useStudyStore.getState().saved[projectId] || []).find((r) => r.kind === 'podcast' && r.podcast?.length);
}

/** Builds a project game. All AI output is grounded in the project's documents. */
export async function generateGame(projectId: string, type: GameType, topic: string, onStep: (m: string) => void = () => undefined): Promise<StudyResult> {
  const info = PROJECT_GAMES.find((g) => g.type === type);
  const title = info?.label ?? 'Game';
  const make = (sources: Source[], data: any, extraTitle = ''): StudyResult => ({
    kind: 'game', createdAt: Date.now(), topic: topic.trim(), title: extraTitle || title, sources, game: { type, data },
  });

  if (type === 'review') {
    seedReviewItems(projectId);
    return make([], {});
  }
  if (type === 'podcastquiz') {
    const pod = latestPodcast(projectId);
    if (!pod) throw new Error('Make a podcast episode in this project first, then quiz yourself on it.');
    onStep('Writing questions about the episode...');
    const script = pod.podcast!.map((l, i) => `(${i}) ${l.host}: ${l.text}`).join('\n');
    const raw = await askJson<any>(
      'You write quiz questions about a podcast script. Use only what the hosts say.',
      `SCRIPT (line numbers in brackets):\n${script.slice(0, 9000)}\n\nWrite 3-5 questions. For each, give the line number that answers it.\nJSON: {"questions":[{"q":"","options":["right","wrong","wrong","wrong"],"answer":0,"why":"","line":3}]}`,
    );
    const qs: McQuestion[] = (raw?.questions ?? []).map((x: any, i: number) => {
      const options: string[] = (x?.options ?? []).map((o: unknown) => str(o, 140)).filter(Boolean);
      const answer = Number(x?.answer);
      if (!str(x?.q) || options.length < 3 || !(answer >= 0 && answer < options.length)) return null;
      const order = shuffle(options.map((_, k) => k), Date.now() + i);
      return { q: str(x.q), options: order.map((k) => options[k]), answer: order.indexOf(answer), why: str(x?.why), src: [], line: Math.max(0, Math.min(pod.podcast!.length - 1, Number(x?.line) || 0)) };
    }).filter(Boolean);
    if (qs.length < 2) throw new Error('The model did not write usable questions. Try again.');
    return make(pod.sources, { questions: qs, podcastAt: pod.createdAt, lines: pod.podcast, hosts: pod.hosts }, `Podcast quiz: ${pod.title || 'episode'}`);
  }

  onStep('Reading your project documents...');
  const sources = await sourcesOrThrow(projectId, topic);

  if (type === 'daily') {
    seedReviewItems(projectId);
    return make(sources, { day: new Date().toISOString().slice(0, 10) });
  }
  if (['pairs', 'hangman', 'cloze', 'feynman', 'palace', 'scramble'].includes(type)) {
    onStep('Finding key terms in your documents...');
    const terms = await termsFromSources(sources, topic, type === 'pairs' ? 4 : 3);
    if (type === 'pairs') return make(sources, { terms, cards: buildPairs(terms, Math.min(8, terms.length), Date.now()) });
    if (type === 'hangman') return make(sources, { terms });
    if (type === 'scramble') {
      const longEnough = terms.filter((t) => t.answer.length >= 4).slice(0, 12);
      if (longEnough.length < 3) throw new Error('These documents gave too few terms of four letters or more for a word scramble. Try another topic.');
      return make(sources, { terms: longEnough });
    }
    if (type === 'feynman') return make(sources, { terms, concepts: terms.map((t) => t.answer) });
    if (type === 'palace') {
      onStep('Building your memory palace...');
      return make(sources, { terms, stations: await palace(sources, terms) });
    }
    const items: ClozeItem[] = buildCloze(terms, sources, 10, Date.now());
    if (items.length < 3) throw new Error('Not enough sentences with key terms were found for fill-the-blanks. Try another topic.');
    return make(sources, { terms, items });
  }
  if (type === 'truefalse') {
    onStep('Writing statements...');
    return make(sources, { statements: await statements(sources, 14, topic) });
  }
  if (type === 'timeline') {
    onStep('Finding events and steps...');
    return make(sources, await orderItems(sources, topic));
  }
  if (type === 'sort') {
    onStep('Choosing categories...');
    return make(sources, await sortData(sources, topic));
  }
  if (type === 'jeopardy') return make(sources, { board: await jeopardyBoard(sources, topic, onStep) });
  if (type === 'boss') {
    onStep('Summoning the boss...');
    const questions = await mcQuestions(sources, 9, topic);
    return make(sources, { questions: questions.sort((a, b) => (a.difficulty ?? 2) - (b.difficulty ?? 2)), boss: Math.floor(Math.random() * 6) });
  }
  if (type === 'ladder') {
    onStep('Writing the ladder questions...');
    // 10 rungs plus 2 spares for the Skip lifeline.
    const questions = await mcQuestions(sources, 12, topic);
    if (questions.length < 6) throw new Error('The model did not write enough questions for a ladder. Try again.');
    const ordered = questions.slice(0, 10).sort((a, b) => (a.difficulty ?? 2) - (b.difficulty ?? 2));
    return make(sources, { questions: ordered, spares: questions.slice(10) });
  }
  if (type === 'mistake') {
    onStep('Writing statements with mistakes...');
    const items = buildFixItems(await statements(sources, 16, topic), Date.now());
    if (items.length < 3) throw new Error('The model did not write enough false statements with corrections. Try again or use a bigger model.');
    return make(sources, { items });
  }
  if (type === 'exam') {
    onStep('Writing multiple-choice questions...');
    const mc = await mcQuestions(sources, 10, topic);
    onStep('Writing true/false questions...');
    const tf = await statements(sources, 6, topic).catch(() => [] as Statement[]);
    onStep('Finding fill-the-blank sentences...');
    const terms = await termsFromSources(sources, topic, 1).catch(() => [] as LearningTerm[]);
    const cloze = terms.length ? buildCloze(terms, sources, 4, Date.now()) : [];
    return make(sources, { mc, tf, cloze, minutes: Math.max(5, Math.round((mc.length + tf.length + cloze.length) * 0.75)) });
  }
  if (type === 'conceptmap') {
    onStep('Drawing the concept map...');
    return make(sources, await conceptMap(sources, topic));
  }
  // Live (conversation) games only need the sources up front.
  if (type === 'tutor') return make(sources, { goal: topic.trim() || 'the main ideas in these documents' });
  if (type === 'levels') return make(sources, { topic: topic.trim() || 'the main ideas in these documents', texts: {} });
  if (type === 'mnemonic') return make(sources, { results: [] });
  throw new Error('Unknown game.');
}

// ----------------------------------------------------------------- live (play-time) model calls
export async function gradeExplanation(sources: Source[], concept: string, explanation: string): Promise<{ score: number; correct: string[]; missed: { point: string; src: number[] }[]; wrong: { claim: string; fix: string; src: number[] }[]; followUp: string }> {
  const raw = await askJson<any>(
    `You are a fair teacher grading a student's explanation against documents. ${GROUND}`,
    `SOURCES:\n${sourceBlock(sources)}\n\nConcept: ${concept}\nStudent's explanation: """${explanation.slice(0, 2000)}"""\nGrade it 0-10. List what is correct, important points missed, and anything wrong with the fix.\nJSON: {"score":7,"correct":[""],"missed":[{"point":"","src":[1]}],"wrong":[{"claim":"","fix":"","src":[1]}],"follow_up":"one question"}`,
  );
  const valid = nums(sources);
  return {
    score: Math.min(10, Math.max(0, Math.round(Number(raw?.score) || 0))),
    correct: (raw?.correct ?? []).map((x: unknown) => str(x, 200)).filter(Boolean),
    missed: (raw?.missed ?? []).map((x: any) => ({ point: str(x?.point ?? x, 200), src: srcList(x?.src, valid) })).filter((x: any) => x.point),
    wrong: (raw?.wrong ?? []).map((x: any) => ({ claim: str(x?.claim, 200), fix: str(x?.fix, 200), src: srcList(x?.src, valid) })).filter((x: any) => x.claim),
    followUp: str(raw?.follow_up ?? raw?.followUp, 200),
  };
}

export const LEVELS = ['Age 5', 'Age 10', 'High school', 'University', 'Expert'];
export async function explainAtLevel(sources: Source[], topic: string, level: number): Promise<string> {
  const who = ['a 5-year-old: tiny words, a friendly example', 'a 10-year-old: simple words and an everyday comparison', 'a high-school student: clear and complete', 'a university student: precise terms and mechanisms', 'an expert: dense, technical, with nuances and caveats'][level] ?? 'a high-school student';
  return askModel(
    `You explain topics from documents. ${GROUND}`,
    `SOURCES:\n${sourceBlock(sources)}\n\nExplain "${topic}" for ${who}. Keep the [n] source numbers. 120-200 words.`,
  );
}

export async function makeMnemonics(items: string[]): Promise<{ acronym: string; sentence: string; rhyme: string; story: string }> {
  const raw = await askJson<any>(
    'You make memory aids (mnemonics) for lists.',
    `List to remember, in order:\n${items.map((x, i) => `${i + 1}. ${x}`).join('\n')}\nMake: an acronym from the first letters, a memorable sentence whose words start with those letters in order, a short rhyme, and a 2-3 sentence silly story.\nJSON: {"acronym":"","sentence":"","rhyme":"","story":""}`,
  );
  return { acronym: str(raw?.acronym, 30), sentence: str(raw?.sentence, 200), rhyme: str(raw?.rhyme, 300), story: str(raw?.story, 500) };
}

/** One Socratic tutor turn: never gives the answer outright. */
export async function tutorTurn(sources: Source[], goal: string, history: { role: 'user' | 'assistant'; content: string }[]): Promise<string> {
  const { llmService } = require('../../services/llm');
  const system = `You are a Socratic tutor. The learner's goal: ${goal}. Teach ONLY from these sources:\n${sourceBlock(sources).slice(0, 6000)}\n\nRules: never state the final answer directly. Ask ONE short guiding question at a time. After two wrong tries, give a hint. When the learner gets it, confirm clearly and say "Got it!" then suggest the next step. Keep replies under 60 words.`;
  await require('../../atlasTools/models').ensureTextModel(null);
  const messages = [{ id: 's', role: 'system', content: system, timestamp: 0 }, ...history.map((m, i) => ({ id: `h${i}`, role: m.role, content: m.content, timestamp: i + 1 }))];
  if (history.length === 0) messages.push({ id: 'start', role: 'user', content: 'Start the lesson with your first question.', timestamp: 1 });
  const out: string = await runBackgroundJob(() => llmService.generateResponse(messages, { disableThinking: true }));
  return out.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}
