/**
 * The board's extras, the way the learner meets them: a lesson left halfway carries on where
 * it stopped, the word search hides the target-language words for an English word bank,
 * tapping a word shows its meaning, and word-order tiles include words that do not belong.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockNav = { navigate: jest.fn(), goBack: jest.fn() };
let mockParams: any = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
}));

import { LessonScreen } from '../../../src/language/LessonScreen';
import { WordSearchScreen } from '../../../src/language/WordSearchScreen';
import { Tappable } from '../../../src/language/Tappable';
import { useLanguage } from '../../../src/language/store';
import { languageService } from '../../../src/language/languageService';
import { buildLesson, words } from '../../../src/language/lessons';

const colours = [
  { en: 'red', t: 'rojo' }, { en: 'blue', t: 'azul' }, { en: 'green', t: 'verde' }, { en: 'white', t: 'blanco' },
  { en: 'black', t: 'negro' }, { en: 'yellow', t: 'amarillo' }, { en: 'The car is red.', t: 'El coche es rojo.' },
  { en: 'I like the blue house.', t: 'Me gusta la casa azul.' },
];

beforeEach(() => {
  mockNav.goBack.mockClear();
  useLanguage.setState({
    language: 'es-ES', content: { 'es-ES': { basics: colours } }, progress: {}, xp: 0,
    streak: { day: '', count: 0 }, saved: {}, glossary: {}, memory: {},
  });
});

it('carries on a lesson where the learner left it', async () => {
  mockParams = { unitId: 'basics', key: 'basics' };
  const first = render(<LessonScreen />);
  await waitFor(() => expect(first.queryByText(/Getting the words ready/)).toBeNull());
  const ex = first.UNSAFE_root.findAllByType(require('../../../src/language/Exercises').ExerciseView)[0].props.ex;
  fireEvent.press(first.getByLabelText(ex.answer));
  fireEvent.press(first.getByTestId('lesson-check'));
  fireEvent.press(first.getByTestId('lesson-continue'));
  first.unmount();

  expect(languageService.savedLesson('basics')?.index).toBe(1);
  const again = render(<LessonScreen />);
  await waitFor(() => expect(again.queryByText(/Getting the words ready/)).toBeNull());
  const shown = again.UNSAFE_root.findAllByType(require('../../../src/language/Exercises').ExerciseView)[0].props.ex;
  expect(shown).toEqual(languageService.savedLesson('basics')!.exercises[1]);
});

it('hides the Spanish words for an English word bank, and finishing marks the square done', async () => {
  mockParams = { unitId: 'basics', key: 'wordsearch@1.11' };
  const screen = render(<WordSearchScreen />);
  await screen.findByTestId('wordsearch-grid');
  expect(screen.getByText('red')).toBeTruthy();
  // Find every hidden word by tapping its first and last letter.
  const cells = screen.getAllByLabelText(/^\S+ \d+-\d+$/).map((c) => c.props.accessibilityLabel as string);
  const size = Math.sqrt(cells.length);
  const letters = cells.map((l) => l.split(' ')[0]);
  const bank = ['ROJO', 'AZUL', 'VERDE', 'BLANCO', 'NEGRO', 'AMARILLO'];
  const cell = (i: number) => screen.getByLabelText(`${letters[i]} ${Math.floor(i / size) + 1}-${(i % size) + 1}`);
  for (const w of bank) {
    // Filler letters can spell a word by chance: try each place it appears until it counts.
    const before = screen.getByText(/ of \d+$/).props.children.join('');
    const places = findWord(letters, size, w);
    expect(places.length).toBeGreaterThan(0);
    for (const [start, end] of places) {
      fireEvent.press(cell(start));
      fireEvent.press(cell(end));
      if (screen.queryByTestId('wordsearch-done') || screen.getByText(/ of \d+$/).props.children.join('') !== before) break;
    }
  }
  expect(await screen.findByTestId('wordsearch-done')).toBeTruthy();
  expect(languageService.isDone('wordsearch@1.11')).toBe(true);
}, 20000);

it('shows a word\'s meaning when it is tapped', async () => {
  useLanguage.setState({ glossary: { 'es-ES': { coche: 'car' } } });
  const screen = render(<Tappable text="El coche es rojo." />);
  fireEvent.press(screen.getByLabelText('Meaning of coche'));
  expect(await screen.findByText(/= car/)).toBeTruthy();
});

it('shows how to conjugate a tapped verb, offline for Spanish', async () => {
  useLanguage.setState({ glossary: { 'es-ES': { hablo: 'I speak (hablar: to speak)', coche: 'car' } } });
  const screen = render(<Tappable text="Yo hablo español." />);
  fireEvent.press(screen.getByLabelText('Meaning of hablo'));
  expect(await screen.findByText(/I speak/)).toBeTruthy();
  fireEvent.press(await screen.findByTestId('word-conjugate'));
  expect(await screen.findByText('yo hablo')).toBeTruthy();
  // The other tenses are behind tabs.
  expect(screen.queryByText('yo hablé')).toBeNull();
  fireEvent.press(screen.getByTestId('tense-Past'));
  expect(screen.getByText('yo hablé')).toBeTruthy();
  fireEvent.press(screen.getByTestId('tense-Future'));
  expect(screen.getByText('nosotros hablaremos')).toBeTruthy();
  fireEvent.press(screen.getByTestId('word-conjugate'));
  expect(screen.queryByTestId('conjugation-table')).toBeNull();
});

it('says a tapped word aloud and saves it to My words', async () => {
  useLanguage.setState({ glossary: { 'es-ES': { coche: 'car' } }, myWords: {} });
  const screen = render(<Tappable text="El coche es rojo." />);
  fireEvent.press(screen.getByLabelText('Meaning of coche'));
  await screen.findByText(/= car/);
  fireEvent.press(screen.getByTestId('word-save'));
  expect(useLanguage.getState().myWords['es-ES']).toEqual([{ en: 'car', t: 'coche' }]);
  expect(screen.getByLabelText('Saved to My words')).toBeTruthy();
  expect(screen.getByTestId('word-hear')).toBeTruthy();
});

it('adds words that do not belong to the word-order tiles', () => {
  const lesson = buildLesson(colours, 7, { length: 14, production: 0.5 });
  const build = lesson.find((e) => e.kind === 'build' || e.kind === 'hear') as { tiles: string[]; answer: string };
  expect(build).toBeTruthy();
  expect(build.tiles.length).toBeGreaterThanOrEqual(words(build.answer).length + 2);
});

/** First and last cell of every place a word appears, in any of the eight directions. */
function findWord(letters: string[], size: number, word: string): [number, number][] {
  const w = [...word];
  const out: [number, number][] = [];
  for (let i = 0; i < letters.length; i++) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1], [0, -1], [-1, 0], [-1, -1], [-1, 1]]) {
      const r0 = Math.floor(i / size), c0 = i % size;
      const ok = w.every((ch, k) => {
        const r = r0 + dr * k, c = c0 + dc * k;
        return r >= 0 && c >= 0 && r < size && c < size && letters[r * size + c] === ch;
      });
      if (ok) out.push([i, (r0 + dr * (w.length - 1)) * size + c0 + dc * (w.length - 1)]);
    }
  }
  return out;
}

it('turns the right and wrong sounds off from the board', () => {
  const { LanguageScreen } = require('../../../src/language/LanguageScreen');
  useLanguage.setState({ sounds: true });
  const board = render(<LanguageScreen />);
  fireEvent.press(board.getByLabelText('Sounds on'));
  expect(board.getByLabelText('Sounds off')).toBeTruthy();
  expect(useLanguage.getState().sounds).toBe(false);
});

it('brings a missed exercise back at the end, and scores only the first try', async () => {
  const { playLesson } = require('./playLesson');
  mockParams = { unitId: 'basics', key: 'basics' };
  const lesson = render(<LessonScreen />);
  await waitFor(() => expect(lesson.queryByText(/Getting the words ready/)).toBeNull());
  const seen = new Set<string>();
  await playLesson(lesson, seen, true);
  expect(seen.has('again')).toBe(true);
  const summary = lesson.getByText(/ of \d+ right/).props.children.join('');
  const [, right, total] = summary.match(/^(\d+) of (\d+) right/)!;
  expect(Number(right)).toBe(Number(total) - 1);
});

it('ends each level with a checkpoint that marks the square done when passed', async () => {
  const { playLesson } = require('./playLesson');
  const { boardFor } = require('../../../src/language/board');
  const last = boardFor(1)[boardFor(1).length - 1];
  expect(last).toMatchObject({ kind: 'checkpoint', title: 'A1 checkpoint' });
  mockParams = { unitId: 'help', mode: 'checkpoint', key: last.key, level: 1 };
  const lesson = render(<LessonScreen />);
  await waitFor(() => expect(lesson.queryByText(/Getting the words ready/)).toBeNull());
  await playLesson(lesson);
  expect(lesson.getByText(/^Passed: \d+ of \d+ right/)).toBeTruthy();
  expect(languageService.isDone(last.key)).toBe(true);
}, 20000);

it('puts an exam on the board every few lessons that tests the lessons before it, passed at 70%', async () => {
  const { playLesson } = require('./playLesson');
  const { boardFor } = require('../../../src/language/board');
  const { unitById } = require('../../../src/language/curriculum');
  const spaces = boardFor(1);
  const at = spaces.findIndex((x: any) => x.kind === 'exam');
  expect(at).toBeGreaterThan(8);
  expect(spaces.filter((x: any) => x.kind === 'lesson').length).toBeGreaterThan(8);
  // The lessons the exam covers are written; then the exam asks about them.
  const covered = spaces.slice(0, at).filter((x: any) => x.kind === 'lesson').map((x: any) => unitById(x.unitId)).filter((u: any) => !u.builtIn);
  useLanguage.setState({ content: { 'es-ES': Object.fromEntries(covered.map((u: any) => [u.id, u.items.map((en: string, i: number) => ({ en, t: `palabra ${u.id} ${i}` }))])) } });
  mockParams = { unitId: covered[0]?.id ?? 'basics', mode: 'exam', key: spaces[at].key, level: 1 };
  const lesson = render(<LessonScreen />);
  await waitFor(() => expect(lesson.queryByText(/Getting the words ready/)).toBeNull());
  await playLesson(lesson);
  expect(lesson.getByText(/^Passed: \d+ of \d+ right/)).toBeTruthy();
  expect(languageService.isDone(spaces[at].key)).toBe(true);
}, 30000);

it('reviews studied words on a review square', async () => {
  const { playLesson } = require('./playLesson');
  useLanguage.setState({ progress: { 'es-ES': { basics: { stars: 1, lessons: 1 } } } });
  mockParams = { unitId: 'basics', mode: 'review', key: 'review@1.9' };
  const lesson = render(<LessonScreen />);
  await waitFor(() => expect(lesson.queryByText(/Getting the words ready/)).toBeNull());
  await playLesson(lesson);
  expect(lesson.getByTestId('lesson-done')).toBeTruthy();
  expect(languageService.isDone('review@1.9')).toBe(true);
}, 20000);

it('asks the learner to say phrases out loud when the phone has a speech recognizer', async () => {
  const { playLesson } = require('./playLesson');
  const RN = require('react-native');
  const os = RN.Platform.OS;
  RN.Platform.OS = 'android';
  RN.PermissionsAndroid.request = jest.fn(async () => 'granted');
  try {
    useLanguage.setState({ speaking: true });
    mockParams = { unitId: 'basics', key: 'basics' };
    const lesson = render(<LessonScreen />);
    await waitFor(() => expect(lesson.queryByText(/Getting the words ready/)).toBeNull());
    const seen = new Set<string>();
    await playLesson(lesson, seen);
    expect(seen.has('speak')).toBe(true);
    expect(lesson.getByTestId('lesson-done')).toBeTruthy();
  } finally { RN.Platform.OS = os; }
}, 20000);

it('tracks a daily XP goal on the board, and the goal can be changed', () => {
  const { LanguageScreen } = require('../../../src/language/LanguageScreen');
  useLanguage.setState({ goal: 100, today: { day: '', xp: 0 } });
  languageService.finishLesson('basics', { right: 6, total: 8 });
  const board = render(<LanguageScreen />);
  expect(board.getByText('60 / 100 XP today')).toBeTruthy();
  fireEvent.press(board.getByTestId('language-goal'));
  expect(board.getByText('60 / 200 XP today')).toBeTruthy();
  languageService.finishLesson('intro', { right: 8, total: 8 });
  languageService.finishLesson('numbers', { right: 8, total: 8 });
  expect(render(<LanguageScreen />).getByText('Goal met')).toBeTruthy();
});

it('makes higher levels harder: more choices that look alike, more stray word tiles', () => {
  const { difficultyFor } = require('../../../src/language/lessons');
  const items = [
    { en: 'house', t: 'casa' }, { en: 'hunting', t: 'caza' }, { en: 'face', t: 'cara' }, { en: 'cart', t: 'carro' },
    { en: 'dog', t: 'perro' }, { en: 'bread', t: 'pan' }, { en: 'I live in a big house.', t: 'Vivo en una casa grande.' },
    { en: 'The dog eats bread every day.', t: 'El perro come pan todos los días.' },
  ];
  const pick = (level: number) => {
    for (let seed = 1; seed < 200; seed++) {
      const ex = buildLesson(items, seed, { length: 10, difficulty: difficultyFor(level) })
        .find((e: any) => e.kind === 'choose' && ['casa', 'caza', 'cara', 'carro'].includes(e.answer));
      if (ex) return ex as any;
    }
    throw new Error('no choose exercise');
  };
  const easy = pick(1);
  const hard = pick(4);
  expect(easy.options).toHaveLength(4);
  expect(hard.options).toHaveLength(6);
  // At B2 the wrong choices start like the answer.
  const sameStart = hard.options.filter((o: string) => o !== hard.answer && o[0] === hard.answer[0]).length;
  expect(sameStart).toBeGreaterThanOrEqual(2);
});

it('lets a phone without a speech recognizer still practise speaking, checked by the learner', async () => {
  const { ExerciseView } = require('../../../src/language/Exercises');
  const picked: string[] = [];
  const ex = { kind: 'speak', item: { en: 'Good morning.', t: 'Buenos días.' }, answer: 'Buenos días.' };
  const view = render(<ExerciseView ex={ex} lang="es-ES" langName="Spanish" attempt={{ value: '', checked: false }}
    onPick={(v: string) => picked.push(v)} onMatched={() => undefined} />);
  fireEvent.press(view.getByTestId('lesson-speak'));
  expect(await view.findByTestId('lesson-self-check')).toBeTruthy();
  fireEvent.press(view.getByTestId('lesson-said-it'));
  expect(picked).toEqual(['Buenos días.']);
});

it('offers the learner check when the speech recognizer cannot listen (microphone refused)', async () => {
  const { Platform, PermissionsAndroid } = require('react-native');
  const os = Platform.OS;
  Platform.OS = 'android';
  const ask = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
  try {
    const { ExerciseView } = require('../../../src/language/Exercises');
    const picked: string[] = [];
    const ex = { kind: 'speak', item: { en: 'Thank you.', t: 'Gracias.' }, answer: 'Gracias.' };
    const view = render(<ExerciseView ex={ex} lang="es-ES" langName="Spanish" attempt={{ value: '', checked: false }}
      onPick={(v: string) => picked.push(v)} onMatched={() => undefined} />);
    fireEvent.press(view.getByTestId('lesson-speak'));
    expect(await view.findByTestId('lesson-self-check')).toBeTruthy();
    expect(view.getByText(/Microphone permission is needed/)).toBeTruthy();
    fireEvent.press(view.getByTestId('lesson-not-yet'));
    expect(picked).toEqual(['-']);
  } finally { Platform.OS = os; ask.mockRestore(); }
});
