/**
 * Learn a language: the board starts with the first unit open and the rest locked. The
 * Health and help unit (built from the phone's phrase cards, no model needed) can be played
 * through; finishing a lesson gives stars, XP and a streak, moves the token on and opens the
 * next unit. The model's translations are checked before they are kept.
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

import { LanguageScreen } from '../../../src/language/LanguageScreen';
import { LessonScreen } from '../../../src/language/LessonScreen';
import { useLanguage } from '../../../src/language/store';
import { boardFor } from '../../../src/language/board';
import { parseUnitWords } from '../../../src/language/languageService';
import { playLesson } from './playLesson';

beforeEach(() => useLanguage.setState({ language: 'es-ES', content: {}, progress: {}, xp: 0, streak: { day: '', count: 0 } }));

it('plays the Health and help unit and moves along the board', async () => {
  // Health and help is the last Basic unit, split into two lessons: finish every space before it so it is open.
  const spaces = boardFor(1);
  const at = spaces.findIndex((s) => s.key === 'help');
  useLanguage.setState({ progress: { 'es-ES': Object.fromEntries(spaces.slice(0, at).map((s) => [s.key, { stars: 1, lessons: 1 }])) } });
  const board = render(<LanguageScreen />);
  expect(board.getByLabelText('Health and help 1/2')).toBeTruthy();
  expect(board.getByLabelText('Health and help 2/2, locked')).toBeTruthy();
  fireEvent.press(board.getByTestId('space-help'));
  expect(mockNav.navigate).toHaveBeenCalledWith('Lesson', { unitId: 'help', part: 1, parts: 2, key: 'help' });

  mockParams = { unitId: 'help', part: 1, parts: 2, key: 'help' };
  const lesson = render(<LessonScreen />);
  await waitFor(() => expect(lesson.queryByText(/Getting the words ready/)).toBeNull());
  const seen = new Set<string>();
  await playLesson(lesson, seen);
  // Duolingo-style kinds: translate, meaning, fill in the blank, listen, word order, tap what you hear, match.
  expect(seen.has('match')).toBe(true);
  expect(seen.size).toBeGreaterThanOrEqual(6);
  expect(lesson.getByTestId('lesson-done')).toBeTruthy();
  expect(useLanguage.getState().progress['es-ES'].help.stars).toBe(3);
  expect(useLanguage.getState().xp).toBeGreaterThanOrEqual(60);
  expect(useLanguage.getState().streak.count).toBe(1);

  const after = render(<LanguageScreen />);
  expect(after.getByLabelText('Health and help 1/2, done')).toBeTruthy();
  expect(after.getByLabelText('Health and help 2/2')).toBeTruthy();
});

it('opens only the first unit at the start', () => {
  const board = render(<LanguageScreen />);
  expect(board.getByLabelText('Basics')).toBeTruthy();
  expect(board.getByLabelText('Meeting people, locked')).toBeTruthy();
});

it('keeps model translations only when every item is translated', () => {
  const en = ['hello', 'goodbye'];
  expect(parseUnitWords('[{"en":"hello","t":"hola"},{"en":"goodbye","t":"adiós"}]', en, 'es-ES')).toEqual([{ en: 'hello', t: 'hola' }, { en: 'goodbye', t: 'adiós' }]);
  expect(parseUnitWords('[{"en":"hello","t":"hola"}]', en, 'es-ES')).toBeNull();
  expect(parseUnitWords('[{"t":"hello"},{"t":"goodbye"}]', en, 'es-ES')).toBeNull();
});

it('looks like a board game: START and FINISH squares, a pawn on your square, and a button for your turn', () => {
  const board = render(<LanguageScreen />);
  expect(board.getByText('START')).toBeTruthy();
  expect(board.getByText('FINISH')).toBeTruthy();
  expect(board.getByTestId('board-pawn')).toBeTruthy();
  expect(board.getByText('Your turn')).toBeTruthy();
  fireEvent.press(board.getByTestId('board-take-turn'));
  expect(mockNav.navigate).toHaveBeenCalledWith('Lesson', expect.objectContaining({ unitId: 'basics' }));
});
