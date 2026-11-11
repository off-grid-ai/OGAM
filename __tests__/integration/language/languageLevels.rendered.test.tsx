/**
 * Levels and the course method: the board has Basic to Fluent with vocabulary, grammar and
 * theme units (first unit of each level open), a grammar lesson shows its rule first, typed
 * answers forgive missing accents, missed words come back in Review (spaced repetition),
 * the speed round runs on a one-minute clock, and practice chats follow the chosen level.
 */
import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';

const mockNav = { navigate: jest.fn(), goBack: jest.fn() };
let mockParams: any = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
}));

import { LanguageScreen } from '../../../src/language/LanguageScreen';
import { LessonScreen } from '../../../src/language/LessonScreen';
import { useLanguage } from '../../../src/language/store';
import { REVIEW, languageService } from '../../../src/language/languageService';
import { parseUnitLesson } from '../../../src/language/coursePrompts';
import { checkTyped } from '../../../src/language/lessons';
import { levelGuide } from '../../../src/language/teaching';
import { useProjectStore } from '../../../src/stores/projectStore';
import { boardFor } from '../../../src/language/board';
import { unitById } from '../../../src/language/curriculum';

const past = [
  { en: 'I ate bread.', t: 'Comí pan.' }, { en: 'We went home.', t: 'Fuimos a casa.' }, { en: 'She worked yesterday.', t: 'Ella trabajó ayer.' },
  { en: 'They spoke a lot.', t: 'Ellos hablaron mucho.' }, { en: 'I lived in Madrid.', t: 'Viví en Madrid.' }, { en: 'You drank coffee.', t: 'Tomaste café.' },
  { en: 'He bought a car.', t: 'Él compró un coche.' }, { en: 'We saw a film.', t: 'Vimos una película.' }, { en: 'I called my mother.', t: 'Llamé a mi madre.' },
  { en: 'You opened the door.', t: 'Abriste la puerta.' },
];

beforeEach(() => useLanguage.setState({ language: 'es-ES', level: 1, content: {}, progress: {}, xp: 0, streak: { day: '', count: 0 }, listening: {}, myWords: {}, tips: {}, memory: {} }));

it('shows six CEFR levels with vocabulary, grammar and theme units, and opens the first unit of each', () => {
  const board = render(<LanguageScreen />);
  expect(board.getByLabelText('Basics')).toBeTruthy();
  fireEvent.press(board.getByLabelText('B1, Intermediate'));
  expect(useLanguage.getState().level).toBe(3);
  // Grammar is split into two lessons; only the first space of the level is open.
  expect(board.getByLabelText('What happened 1/2')).toBeTruthy();
  expect(board.getByLabelText('What happened 2/2, locked')).toBeTruthy();
  expect(boardFor(3).some((s) => s.unitId && unitById(s.unitId)?.kind === 'theme')).toBe(true);
  // Practice chats in the project now follow B1.
  expect(useProjectStore.getState().getProject('spanish-learning')!.systemPrompt).toMatch(/level 3 \(Intermediate, CEFR B1\)/);
});

it('checks a written grammar lesson and shows its rule before the exercises', async () => {
  const raw = JSON.stringify({ tip: 'The past tense says what you did. Add -é for I: hablé.', items: [...past, { en: 'Too long', t: 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis' }] });
  const lesson = parseUnitLesson(raw, levelGuide(3), 'es-ES')!;
  expect(lesson.items).toHaveLength(10);
  expect(lesson.items.find((x) => x.en === 'Too long')).toBeUndefined();
  useLanguage.setState({ content: { 'es-ES': { 'g-past': lesson.items } }, tips: { 'es-ES': { 'g-past': lesson.tip } } });

  mockParams = { unitId: 'g-past' };
  const screen = render(<LessonScreen />);
  expect(await screen.findByTestId('lesson-tip')).toBeTruthy();
  expect(screen.getByText('How it works')).toBeTruthy();
  expect(screen.getByText(/Add -é for I/)).toBeTruthy();
  fireEvent.press(screen.getByTestId('lesson-start'));
  expect(screen.queryByTestId('lesson-tip')).toBeNull();
});

it('accepts a typed answer with missing accents, and tells the learner', () => {
  expect(checkTyped('comi pan', 'Comí pan.')).toBe('accents');
  expect(checkTyped('Comí pan', 'Comí pan.')).toBe('right');
  expect(checkTyped('como pan', 'Comí pan.')).toBe('wrong');
});

it('brings missed words back in Review', () => {
  useLanguage.setState({ content: { 'es-ES': { 'g-past': past } } });
  languageService.finishLesson('g-past', { right: 6, total: 10, results: past.map((p, i) => ({ t: p.t, right: i >= 5 })) });
  expect(languageService.dueCount()).toBe(5);
  const board = render(<LanguageScreen />);
  fireEvent.press(board.getByTestId('language-review'));
  expect(mockNav.navigate).toHaveBeenCalledWith('Lesson', { unitId: REVIEW });
  return languageService.unitWords(REVIEW).then((items) => expect(items.map((x) => x.t)).toEqual(past.slice(0, 5).map((p) => p.t)));
});

it('runs the speed round on a one-minute clock', async () => {
  jest.useFakeTimers();
  useLanguage.setState({ content: { 'es-ES': { 'g-past': past } }, progress: { 'es-ES': { 'g-past': { stars: 1, lessons: 1 } } } });
  mockParams = { unitId: 'g-past', mode: 'speed' };
  const screen = render(<LessonScreen />);
  await act(async () => { await Promise.resolve(); });
  await waitFor(() => expect(screen.getByTestId('speed-clock')).toBeTruthy());
  for (let s = 0; s < 61; s++) act(() => { jest.advanceTimersByTime(1000); });
  expect(screen.getByTestId('lesson-done')).toBeTruthy();
  expect(screen.getByText(/right in 60 seconds/)).toBeTruthy();
  jest.useRealTimers();
});

it('moves a level saved by the four-level course to the matching CEFR level', async () => {
  const mod = require('@react-native-async-storage/async-storage');
  const AsyncStorage = mod.default ?? mod;
  await AsyncStorage.setItem('atlas-language', JSON.stringify({ state: { ...useLanguage.getState(), level: 2 }, version: 0 }));
  await useLanguage.persist.rehydrate();
  expect(useLanguage.getState().level).toBe(3);
  const board = render(<LanguageScreen />);
  expect(board.getByLabelText('A1, Beginner')).toBeTruthy();
  expect(board.getByLabelText('C2, Proficient')).toBeTruthy();
});

it('never builds a matching game with two pairs that cannot be told apart', () => {
  const { matchPairs } = require('../../../src/language/lessons');
  const items = [
    { en: 'to be', t: 'ser' }, { en: 'to be', t: 'estar' }, { en: 'house', t: 'casa' },
    { en: 'home', t: 'casa' }, { en: 'dog', t: 'perro' }, { en: 'cat', t: 'gato' },
    { en: 'water', t: 'agua' }, { en: 'bread', t: 'pan' },
  ];
  const pairs = matchPairs(items);
  expect(pairs.map((p: any) => p.t)).toEqual(['ser', 'casa', 'perro', 'gato', 'agua']);
  expect(new Set(pairs.map((p: any) => p.en)).size).toBe(pairs.length);
});
