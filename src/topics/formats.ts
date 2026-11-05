/**
 * Learning any topic on a board. The AI plans the course (how many squares, and which kind of square each one is, to fit
 * the subject and how the person likes to learn), then writes each square when it is first opened. This file is the
 * contract between the AI and the app: the kinds of square, the questions the AI is asked, and a strict reader for what it
 * answers. Pure, so it is tested without a device.
 */
import { parseJsonLoose, str } from '../study/games/json';
import { evalExpression } from '../study/mathTools';
import { DRILL_LABELS } from '../study/drills';
import type { Exercise } from '../study/exercises';
import type { PeriodicQuestion } from '../study/periodicQuiz';

export type SquareFormat = 'lesson' | 'quiz' | 'cards' | 'match' | 'order' | 'practice' | 'fill' | 'truefalse' | 'scenario' | 'numeric' | 'worked' | 'table'
  | 'recall' | 'fix' | 'tablefill' | 'sort' | 'dictation' | 'reading' | 'predict' | 'drill' | 'periodic';
const DRILL_TOPICS = Object.values(DRILL_LABELS).join(', ');
export const FORMATS: { id: SquareFormat; label: string; icon: string; use: string }[] = [
  { id: 'drill', label: 'Exact drill', icon: 'cpu', use: `practice problems the app makes and marks itself with exact arithmetic, for ONLY these topics: ${DRILL_TOPICS}. Put the topic words in the title or focus. Use it for accounting, finance and statistics practice` },
  { id: 'periodic', label: 'Periodic table', icon: 'grid', use: 'a real periodic table the learner taps to answer: find an element by symbol, number, name, group and period, or family (halogen, noble gas...). The app makes and marks it. Use it in chemistry and science courses' },
  { id: 'lesson', label: 'Lesson', icon: 'book-open', use: 'a short explanation with sections, an example and key points: for new ideas, rules, worked examples, code to read' },
  { id: 'quiz', label: 'Quiz', icon: 'help-circle', use: 'multiple choice questions with a reason for each answer: to check understanding, scenarios, case studies' },
  { id: 'cards', label: 'Flashcards', icon: 'layers', use: 'terms and definitions, formulas, syntax, vocabulary: to memorise' },
  { id: 'match', label: 'Match', icon: 'link', use: 'pairs to join: terms to meanings, causes to effects, accounts to types, functions to results' },
  { id: 'order', label: 'Put in order', icon: 'list', use: 'steps or events to put in the right order: procedures, algorithms, timelines, processes' },
  { id: 'practice', label: 'Practice', icon: 'edit-3', use: 'an open task the learner answers in their own words or code, which the AI then checks: problems, exercises, short writing' },
  { id: 'fill', label: 'Fill the gap', icon: 'minus-square', use: 'sentences, formulas or code lines with one gap to fill from options: terminology, syntax, key facts' },
  { id: 'truefalse', label: 'True or false', icon: 'check-circle', use: 'quick statements to judge, with the reason: spotting common mistakes and myths' },
  { id: 'scenario', label: 'Scenario', icon: 'git-branch', use: 'a short real-world situation with a decision to make: applying a rule, ethics, judgement calls, troubleshooting' },
  { id: 'numeric', label: 'Calculate', icon: 'hash', use: 'a problem with a numeric answer the learner works out, then sees the working: accounting, maths, physics, finance, statistics' },
  { id: 'worked', label: 'Worked example', icon: 'layers', use: 'one problem solved step by step, each step revealed with its reason: procedures, proofs, debugging, case analysis' },
  { id: 'table', label: 'Table', icon: 'grid', use: 'a comparison or reference table to read and copy: differences between things, formulas, syntax cheat sheets, timelines' },
  { id: 'recall', label: 'Type the answer', icon: 'type', use: 'a prompt the learner answers by typing the term, word, formula or short fact from memory: vocabulary, definitions, spelling, symbols' },
  { id: 'fix', label: 'Fix the mistake', icon: 'tool', use: 'something with a mistake in it that the learner corrects by typing: grammar and punctuation, a wrong calculation line, a bug in one line of code' },
  { id: 'tablefill', label: 'Fill the table', icon: 'columns', use: 'a table with blank cells to fill in: accounting journal entries and ledgers, truth tables, conjugations, unit conversions, periodic-table facts, schedules' },
  { id: 'sort', label: 'Sort into groups', icon: 'filter', use: 'items to sort into two to four groups: acids and bases, assets and liabilities, nouns and verbs, mammals and reptiles, fact and opinion' },
  { id: 'dictation', label: 'Listen and type', icon: 'volume-2', use: 'sentences read aloud that the learner types: spelling, listening in English or another language, medical or technical terms' },
  { id: 'reading', label: 'Read and answer', icon: 'file-text', use: 'a short passage (a text, a case, a data description) followed by questions on it: reading comprehension, case studies, source analysis, word problems' },
  { id: 'predict', label: 'Predict the result', icon: 'terminal', use: 'a piece of code, a circuit, an experiment setup or a formula, with a question about what happens or what it gives: programming, physics, chemistry, spreadsheets' },
];

/**
 * How the best teachers of a few big subject areas mix the kinds of square. Added to the AI's instructions when the subject
 * matches, so one prompt can teach maths as well as English or accounting. The AI still decides; this is its starting point.
 */
const PLAYBOOKS: { match: RegExp; name: string; advice: string }[] = [
  { match: /\b(math|maths|algebra|geometry|calculus|trigonometry|arithmetic|fractions?|statistics|probability|equations?|physics|chemistry stoichiometry)\b/i, name: 'mathematics',
    advice: 'For arithmetic, algebra, geometry, percents, probability, units and basic statistics use exact-drill squares (format drill) with the topic words in the title: linear equations, quadratic equations, adding fractions, percent change, area and perimeter, Pythagoras, slope, mean and median, unit conversion, combinations. Teach maths by doing: a worked example first, then calculate squares with numbers, fill-the-gap and fix-the-mistake squares on steps, predict-the-result squares for graphs and formulas, and a final mixed set. Write maths in plain text with symbols like ², √, ÷, ×, π and fractions as a/b.' },
  { match: /\b(science|biology|chemistry|physics|astronomy|geology|ecology|anatomy|physiology|earth science|environmental)\b/i, name: 'science',
    advice: 'For chemistry add periodic-table squares (format periodic) and exact-drill squares (format drill) for molar mass, moles, pH, and for physics speed, force, kinetic energy, Ohm\'s law, density and the gas law. Teach science with a lesson that uses an everyday analogy, then sort-into-groups, put-in-order for processes and cycles, scenario squares for experiments, true-or-false for common myths, predict-the-result for what happens, and calculate squares for formulas.' },
  { match: /\b(accounting|bookkeeping|finance|financial|tax|audit|economics|budget|investing|payroll|ledger)\b/i, name: 'accounting and finance',
    advice: 'Use exact-drill squares (format drill) for balance sheets, income statements, cash flow statements, trial balances, journal entries, compound interest, loans, bonds, leases, inventory, depreciation, ratios, break-even and NPV: the app makes the numbers, supplies account dropdowns with amounts to type, and marks every line. Teach accounting with worked examples using real numbers, fill-the-table squares for journal entries and ledgers, calculate squares for ratios and depreciation, sort-into-groups for assets, liabilities, income and expenses, scenario squares for judgement calls, and flashcards for terms.' },
  { match: /\b(english|grammar|writing|essay|reading|literature|vocabulary|spelling|punctuation|composition|poetry|esl|ielts|toefl)\b/i, name: 'English and writing',
    advice: 'Teach English with read-and-answer squares on short passages, fix-the-mistake for grammar and punctuation, type-the-answer for vocabulary and spelling, listen-and-type dictation, sort-into-groups for parts of speech, and practice squares where the learner writes a sentence or paragraph for the AI to mark.' },
  { match: /\b(programming|coding|code|python|javascript|java|c\+\+|html|css|sql|software|algorithm|computer science|excel|spreadsheet|data structures?)\b/i, name: 'programming',
    advice: 'Teach programming with a short lesson with a code example, predict-the-result squares on small snippets, fix-the-mistake on one line, practice squares where the learner writes code for the AI to mark, put-in-order for algorithms, and fill-the-gap for syntax.' },
  { match: /\b(history|geography|civics|politics|government|social studies|law|religion|philosophy|anthropology|sociology|psychology)\b/i, name: 'history and social studies',
    advice: 'Teach it with a lesson that tells the story, put-in-order timelines, match for people, places and events, read-and-answer on a short source, scenario squares asking what would you do, and practice squares for a short written argument.' },
  { match: /\b(music|guitar|piano|drawing|painting|art|design|photography|cooking|baking|sport|fitness|yoga|chess|knitting|woodwork|gardening)\b/i, name: 'a skill or craft',
    advice: 'Teach a skill with worked examples of the technique, put-in-order for the steps, true-or-false for common mistakes, scenario squares for what to do when it goes wrong, flashcards for terms, and practice squares describing what the learner did for the AI to give feedback on.' },
  { match: /\b(medicine|medical|nursing|health|nutrition|first aid|pharmacology|dental|veterinary)\b/i, name: 'health',
    advice: 'Teach health with lessons on the body and why, scenario squares with patient situations, sort-into-groups for symptoms and causes, type-the-answer for terms, calculate squares for doses and values, and always say this is for learning, not for treating anyone.' },
];

/** The teaching advice that fits the subject (empty when no big area matches: the AI then works it out itself). */
export function subjectAdvice(topic: string): string {
  const hit = PLAYBOOKS.find((p) => p.match.test(topic));
  return hit ? `Subject area: ${hit.name}. ${hit.advice}` : '';
}
export const FORMAT_IDS = FORMATS.map((f) => f.id);

export interface PlannedSquare { key: string; format: SquareFormat; title: string; focus: string; unit: string; checkpoint?: boolean; remedial?: boolean }
export interface CoursePlan { title: string; summary: string; style: string; theme: string; squares: PlannedSquare[] }

export const MAX_SQUARES = 60;
const asFormat = (v: unknown): SquareFormat => (FORMAT_IDS.includes(String(v).toLowerCase() as SquareFormat) ? (String(v).toLowerCase() as SquareFormat) : 'lesson');

/** What the person asked for, passed to the AI. */
export interface CourseRequest { topic: string; goal: string; level: string; how: string; minutes: number }
/** The learner's own material the course should be built around (titles and the start of each). */
export type PlanSources = { title: string; text: string }[];

export function planMessages(r: CourseRequest, sources: PlanSources = []) {
  const menu = FORMATS.map((f) => `- ${f.id}: ${f.use}`).join('\n');
  return {
    system: 'You are an expert teacher and course designer who can teach any subject. You design a course as a path of squares on a board game. Reply with ONLY JSON.',
    user: `Design a course.
Subject: ${r.topic}
What the learner wants to be able to do: ${r.goal || '(not said: choose a sensible goal for the subject)'}
Their level now: ${r.level}
How they like to learn: ${r.how || '(not said: choose what suits this subject best)'}
Each sitting should take about ${r.minutes} minutes.
${sources.length ? `The learner has gathered this material; build the course around what it covers, in a sensible order:\n${sources.map((x) => `- ${x.title}: ${x.text.slice(0, 220).replace(/\s+/g, ' ')}`).join('\n')}\n` : ''}

Every square is one sitting, and has a format chosen to suit the subject and the learner:
${menu}

${subjectAdvice(r.topic) ? `${subjectAdvice(r.topic)}\n` : ''}Choose the formats yourself. Teach the way this subject is really learned: for example accounting needs worked examples and practice with numbers; coding needs short explanations with code and practice tasks; history suits timelines (put in order) and scenarios; a language-like subject needs flashcards and match. Mix formats so it does not feel the same every square; start with a lesson, put a quiz or practice after every one or two lessons, and finish with a quiz that covers everything.
Use 12 to 30 squares in 2 to 6 units for a narrow topic. When the subject is a whole school or university subject (for example algebra, biology, accounting, English), cover EVERY major part of it from the basics up: use 30 to 60 squares in 6 to 10 units. Order from the basics up, sized to the goal. Use many different formats across the course (at least five), not just lessons and quizzes.

Reply with ONLY this JSON:
{"title": "course title", "summary": "one sentence on what the learner will be able to do", "style": "one sentence on how you will teach it", "theme": "a short fun name for the board journey",
 "units": [{"title": "unit title", "squares": [{"format": "lesson|quiz|cards|match|order|practice", "title": "short square title", "focus": "exactly what this square covers"}]}]}`,
  };
}

/** Reads the AI's course plan; null when it is not usable. Keys are made here, the last square is always a covering quiz. */
export function parsePlan(raw: string): CoursePlan | null {
  const json = parseJsonLoose<any>(raw);
  const units: any[] = Array.isArray(json?.units) ? json.units : [];
  const squares: PlannedSquare[] = [];
  units.forEach((u, ui) => {
    const unit = str(u?.title, 80) || `Unit ${ui + 1}`;
    (Array.isArray(u?.squares) ? u.squares : []).forEach((s: any) => {
      const title = str(s?.title, 60);
      if (!title || squares.length >= MAX_SQUARES) return;
      squares.push({ key: `s${squares.length + 1}`, format: asFormat(s?.format), title, focus: str(s?.focus, 240) || title, unit });
    });
  });
  if (squares.length < 3) return null;
  const last = squares[squares.length - 1];
  if (last.format !== 'quiz') {
    squares.push({ key: `s${squares.length + 1}`, format: 'quiz', title: 'Final quiz', focus: 'Everything in the course', unit: last.unit, checkpoint: true });
  } else last.checkpoint = true;
  return {
    title: str(json?.title, 80) || 'My course', summary: str(json?.summary, 200), style: str(json?.style, 200),
    theme: str(json?.theme, 60), squares,
  };
}

/** Square content, by format. */
export type SquareContent =
  | { kind: 'lesson'; sections: { heading: string; text: string; example?: string }[]; keyPoints: string[]; commonMistakes?: string[]; quickCheck?: { q: string; a: string } }
  | { kind: 'quiz'; questions: { q: string; options: string[]; answer: number; why: string }[]; passage?: string }
  | { kind: 'cards'; cards: { front: string; back: string }[] }
  | { kind: 'match'; pairs: { left: string; right: string }[] }
  | { kind: 'order'; prompt: string; steps: string[] }
  | { kind: 'practice'; task: string; hint?: string; model: string; rubric: string[]; code?: boolean }
  | { kind: 'numeric'; task: string; answer: number; tolerance: number; unit: string; working: string[]; checked?: boolean }
  | { kind: 'drill'; exercises: Exercise[] }
  | { kind: 'periodic'; questions: PeriodicQuestion[] }
  | { kind: 'worked'; problem: string; steps: { step: string; why: string }[]; takeaway: string }
  | { kind: 'table'; title: string; markdown: string }
  | { kind: 'typed'; items: { prompt: string; answer: string; alternatives: string[]; why: string }[]; mode: 'recall' | 'fix' }
  | { kind: 'tablefill'; title: string; columns: string[]; rows: (string | null)[][]; answers: string[][]; why: string }
  | { kind: 'sort'; groups: string[]; items: { text: string; group: number }[] }
  | { kind: 'dictation'; lang: string; sentences: string[] };

export interface SquareRequest { courseTitle: string; topic: string; level: string; how: string; style: string; square: PlannedSquare; before: string[]; minutes: number; excerpts?: { source: string; text: string }[] }

const SHAPES: Record<SquareFormat, string> = {
  drill: '{}  (made by the app, not written by the AI)',
  periodic: '{}  (made by the app, not written by the AI)',
  lesson: '{"sections": [{"heading": "...", "text": "plain explanation, 2-5 sentences, may use short code or numbers", "example": "a worked example or code (optional)"}], "commonMistakes": ["a mistake learners make here and how to avoid it"], "quickCheck": {"q": "one question to test yourself", "a": "its answer"}, "keyPoints": ["..."]}  (3 to 5 sections, 2 or 3 common mistakes, 3 to 6 key points)',
  quiz: '{"questions": [{"q": "...", "options": ["A", "B", "C", "D"], "answer": 0, "why": "one sentence on why that answer is right"}]}  (5 to 8 questions, "answer" is the index of the right option, vary where it is)',
  cards: '{"cards": [{"front": "term or question", "back": "short definition or answer"}]}  (8 to 14 cards)',
  match: '{"pairs": [{"left": "...", "right": "..."}]}  (5 or 6 pairs, every left and every right different)',
  order: '{"prompt": "what to put in order", "steps": ["first step", "second step", "..."]}  (4 to 7 steps, listed in the CORRECT order)',
  practice: '{"task": "what the learner must do, self-contained", "hint": "a nudge (optional)", "model": "a good answer", "rubric": ["what a good answer must include"], "code": true if the answer is code}',
  fill: '{"questions": [{"q": "a sentence, formula or code line with ____ where the gap is", "options": ["A", "B", "C"], "answer": 0, "why": "..."}]}  (6 to 8 items, "answer" is the index of the right option)',
  truefalse: '{"questions": [{"q": "a statement", "options": ["True", "False"], "answer": 0, "why": "the reason it is true or false"}]}  (6 to 8 statements; "answer" is 0 for True or 1 for False; about half false)',
  scenario: '{"questions": [{"q": "a short situation, then the decision to make", "options": ["choice 1", "choice 2", "choice 3"], "answer": 0, "why": "why that is the best choice"}]}  (3 to 5 different situations)',
  numeric: '{"task": "a problem with all the numbers it needs and a single numeric answer", "expression": "the sum as plain arithmetic the app can calculate, e.g. 1000*(1+0.05)^3", "answer": 1250.5, "tolerance": 0.5, "unit": "unit or currency (empty if none)", "working": ["step 1 of the working", "step 2"]}',
  worked: '{"problem": "the problem being solved", "steps": [{"step": "what is done", "why": "the reason"}], "takeaway": "the one thing to remember"}  (4 to 8 steps)',
  recall: '{"items": [{"prompt": "a definition, picture-in-words or question", "answer": "the term or short answer", "alternatives": ["other accepted answers"], "why": "optional note"}]}  (8 to 12 items, answers short)',
  fix: '{"items": [{"prompt": "the text with ONE mistake in it", "answer": "the corrected text", "why": "what was wrong"}]}  (6 to 8 items)',
  tablefill: '{"title": "...", "columns": ["Account", "Debit", "Credit"], "rows": [["Cash", "", "500"], ["Sales", "500", ""]], "blank": [[0, 1], [1, 2]], "why": "short explanation"}  (3 to 8 rows; "rows" holds the FULL correct table; "blank" lists [row, column] cells to hide for the learner, 3 to 8 of them, never the first column)',
  sort: '{"groups": ["Group A", "Group B"], "items": [{"text": "item", "group": 0}]}  (2 to 4 groups, 8 to 14 items, "group" is the index of the right group)',
  dictation: '{"lang": "en-US", "sentences": ["a sentence to be read aloud", "..."]}  (5 to 8 sentences of rising difficulty; "lang" is a BCP-47 code for the language spoken)',
  reading: '{"passage": "a passage of 80 to 200 words, or a case with the facts needed", "questions": [{"q": "...", "options": ["A", "B", "C"], "answer": 0, "why": "..."}]}  (3 to 5 questions that need the passage)',
  predict: '{"questions": [{"q": "a code snippet in a ``` fence, a setup or a formula, then: what does it print / give / happen?", "options": ["A", "B", "C"], "answer": 0, "why": "the reasoning step by step"}]}  (4 to 6 items)',
  table: '{"title": "table title", "columns": ["Column 1", "Column 2"], "rows": [["cell", "cell"]]}  (2 to 5 columns, 3 to 10 rows, short cells)',
};

export function contentMessages(r: SquareRequest) {
  return {
    system: `You are an expert teacher of ${r.topic}. ${r.style ? `Teaching style: ${r.style}.` : ''} Write exactly what is asked, accurately, at the learner's level. Write maths and science in plain text with symbols (², √, ÷, ×, π, fractions as a/b). Reply with ONLY JSON.${subjectAdvice(r.topic) ? ` ${subjectAdvice(r.topic)}` : ''}`,
    user: `Course: ${r.courseTitle}. Learner level: ${r.level}.${r.how ? ` They like to learn: ${r.how}.` : ''}
${r.before.length ? `Squares already done: ${r.before.slice(-8).join('; ')}.\n` : ''}Write the next square: "${r.square.title}" (${r.square.format}). It covers: ${r.square.focus}.${r.square.checkpoint ? ' This is the final check: cover the whole course.' : ''}
It should take about ${r.minutes} minutes. Do not repeat earlier squares.
${r.excerpts?.length ? `Use these passages from the learner's own sources for the facts they cover, and say which source in the text when you rely on one. Where they say nothing, teach from what you know.\n${r.excerpts.map((e) => `[${e.source}] ${e.text}`).join('\n')}\n` : ''}${r.square.remedial ? 'The learner struggled with this before: explain it again in a different way, in simpler words, with a new example.\n' : ''}Reply with ONLY JSON in this shape: ${SHAPES[r.square.format]}`,
  };
}

const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Reads the AI's content for a square; null when it is not usable. */
export function parseContent(format: SquareFormat, raw: string): SquareContent | null {
  const j = parseJsonLoose<any>(raw);
  if (!j) return null;
  if (format === 'lesson') {
    const sections = list(j.sections).map((s) => ({ heading: str(s?.heading, 80), text: str(s?.text, 900), example: str(s?.example, 600) || undefined })).filter((s) => s.text);
    const keyPoints = list(j.keyPoints).map((k) => str(k, 200)).filter(Boolean).slice(0, 8);
    const commonMistakes = list(j.commonMistakes).map((m) => str(m, 240)).filter(Boolean).slice(0, 4);
    const check = j.quickCheck && str(j.quickCheck.q, 240) && str(j.quickCheck.a, 240) ? { q: str(j.quickCheck.q, 240), a: str(j.quickCheck.a, 240) } : undefined;
    return sections.length ? { kind: 'lesson', sections: sections.slice(0, 7), keyPoints, ...(commonMistakes.length ? { commonMistakes } : {}), ...(check ? { quickCheck: check } : {}) } : null;
  }
  if (format === 'quiz' || format === 'fill' || format === 'truefalse' || format === 'scenario' || format === 'reading' || format === 'predict') {
    const questions = list(j.questions).map((q) => {
      const options = list(q?.options).map((o) => str(o, 160)).filter(Boolean).slice(0, 5);
      const answer = Number(q?.answer);
      return { q: str(q?.q, 300), options, answer, why: str(q?.why, 300) };
    }).filter((q) => q.q && q.options.length >= 2 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length);
    const passage = format === 'reading' ? str(j.passage, 2000) : '';
    if (format === 'reading' && !passage) return null;
    return questions.length >= 2 ? { kind: 'quiz', questions: questions.slice(0, 10), ...(passage ? { passage } : {}) } : null;
  }
  if (format === 'cards') {
    const cards = list(j.cards).map((c) => ({ front: str(c?.front, 160), back: str(c?.back, 300) })).filter((c) => c.front && c.back);
    return cards.length >= 3 ? { kind: 'cards', cards: cards.slice(0, 16) } : null;
  }
  if (format === 'match') {
    const seenL = new Set<string>(); const seenR = new Set<string>();
    const pairs = list(j.pairs).map((p) => ({ left: str(p?.left, 100), right: str(p?.right, 140) })).filter((p) => {
      if (!p.left || !p.right || seenL.has(p.left.toLowerCase()) || seenR.has(p.right.toLowerCase())) return false;
      seenL.add(p.left.toLowerCase()); seenR.add(p.right.toLowerCase());
      return true;
    });
    return pairs.length >= 3 ? { kind: 'match', pairs: pairs.slice(0, 7) } : null;
  }
  if (format === 'order') {
    const steps = list(j.steps).map((s) => str(s, 200)).filter(Boolean);
    return steps.length >= 3 ? { kind: 'order', prompt: str(j.prompt, 200) || 'Put these in the right order.', steps: steps.slice(0, 8) } : null;
  }
  if (format === 'recall' || format === 'fix') {
    const items = list(j.items).map((x) => ({ prompt: str(x?.prompt, 300), answer: str(x?.answer, 300), alternatives: list(x?.alternatives).map((a) => str(a, 200)).filter(Boolean).slice(0, 4), why: str(x?.why, 240) })).filter((x) => x.prompt && x.answer);
    return items.length >= 3 ? { kind: 'typed', mode: format, items: items.slice(0, 14) } : null;
  }
  if (format === 'tablefill') {
    const columns = list(j.columns).map((c) => str(c, 40)).filter(Boolean).slice(0, 6);
    const full = list(j.rows).map((r) => list(r).slice(0, columns.length).map((c) => str(c, 60))).filter((r) => r.length === columns.length).slice(0, 10);
    const hide = new Set(list(j.blank).map((b) => `${Number(b?.[0])}:${Number(b?.[1])}`));
    const rows = full.map((r, ri) => r.map((c, ci) => (ci > 0 && hide.has(`${ri}:${ci}`) ? null : c)));
    const blanks = rows.flat().filter((c) => c === null).length;
    if (columns.length < 2 || full.length < 2 || blanks < 2) return null;
    return { kind: 'tablefill', title: str(j.title, 80), columns, rows, answers: full, why: str(j.why, 300) };
  }
  if (format === 'sort') {
    const groups = list(j.groups).map((g) => str(g, 40)).filter(Boolean).slice(0, 4);
    const items = list(j.items).map((x) => ({ text: str(x?.text, 80), group: Number(x?.group) })).filter((x) => x.text && Number.isInteger(x.group) && x.group >= 0 && x.group < groups.length).slice(0, 16);
    return groups.length >= 2 && items.length >= 4 ? { kind: 'sort', groups, items } : null;
  }
  if (format === 'dictation') {
    const sentences = list(j.sentences).map((x) => str(x, 200)).filter(Boolean).slice(0, 8);
    return sentences.length >= 3 ? { kind: 'dictation', lang: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(String(j.lang)) ? String(j.lang) : 'en-US', sentences } : null;
  }
  if (format === 'numeric') {
    const task = str(j.task, 700);
    const answer = Number(j.answer);
    if (!task || !Number.isFinite(answer)) return null;
    const tolerance = Number.isFinite(Number(j.tolerance)) && Number(j.tolerance) >= 0 ? Number(j.tolerance) : Math.abs(answer) * 0.01;
    // The AI also writes the sum as a plain expression; the app works it out itself. If the two disagree, the app's number is used.
    let checked = false; let final = answer;
    try { const computed = evalExpression(String(j.expression ?? '')); checked = true; if (Math.abs(computed - answer) > Math.max(tolerance, Math.abs(computed) * 0.001)) final = Math.round(computed * 1e6) / 1e6; } catch { /* no usable expression: the answer is the AI's own and is labelled so */ }
    return { kind: 'numeric', task, answer: final, tolerance, unit: str(j.unit, 20), working: list(j.working).map((w) => str(w, 300)).filter(Boolean).slice(0, 10), checked };
  }
  if (format === 'worked') {
    const steps = list(j.steps).map((x) => ({ step: str(x?.step, 400), why: str(x?.why, 300) })).filter((x) => x.step);
    const problem = str(j.problem, 500);
    return problem && steps.length >= 2 ? { kind: 'worked', problem, steps: steps.slice(0, 10), takeaway: str(j.takeaway, 300) } : null;
  }
  if (format === 'table') {
    const columns = list(j.columns).map((c) => str(c, 40)).filter(Boolean).slice(0, 5);
    const rows = list(j.rows).map((r) => list(r).slice(0, columns.length).map((c) => str(c, 80).replace(/\|/g, '/'))).filter((r) => r.length === columns.length && r.some(Boolean)).slice(0, 12);
    if (columns.length < 2 || rows.length < 2) return null;
    const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
    return { kind: 'table', title: str(j.title, 80), markdown: [line(columns), line(columns.map(() => '---')), ...rows.map(line)].join('\n') };
  }
  const task = str(j.task, 700);
  if (!task) return null;
  return { kind: 'practice', task, hint: str(j.hint, 300) || undefined, model: str(j.model, 1200), rubric: list(j.rubric).map((r) => str(r, 200)).filter(Boolean).slice(0, 6), code: j.code === true || undefined };
}

export function gradeMessages({ task, model, rubric, answer }: { task: string; model: string; rubric: string[]; answer: string }) {
  return {
    system: 'You are a fair, encouraging teacher marking a learner\'s answer. Reply with ONLY JSON.',
    user: `Task: ${task}\nA good answer: ${model}\nIt should include: ${rubric.join('; ') || '(see the good answer)'}\nLearner's answer:\n${answer}\n\nReply with ONLY: {"score": 0 to 100, "feedback": "2 to 4 sentences: what is right, what is missing or wrong, how to improve"}`,
  };
}

export function parseGrade(raw: string): { score: number; feedback: string } | null {
  const j = parseJsonLoose<any>(raw);
  const score = Number(j?.score);
  const feedback = str(j?.feedback, 700);
  return Number.isFinite(score) && feedback ? { score: Math.max(0, Math.min(100, Math.round(score))), feedback } : null;
}

/** Stars (1 to 3) for a score between 0 and 1: finishing always earns one. */
export const starsForShare = (share: number): 1 | 2 | 3 => (share >= 0.9 ? 3 : share >= 0.65 ? 2 : 1);
