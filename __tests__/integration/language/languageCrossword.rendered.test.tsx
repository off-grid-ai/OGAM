/**
 * The crossword square: English clues, answers typed in the language, optional (Skip moves on); and the
 * board telling the learner how many lessons are left before the exam and where their square is.
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

import { CrosswordScreen } from '../../../src/language/CrosswordScreen';
import { Board } from '../../../src/language/Board';
import { boardFor } from '../../../src/language/board';
import { useLanguage } from '../../../src/language/store';
import { languageService } from '../../../src/language/languageService';

const colours = [
  { en: 'red', t: 'rojo' }, { en: 'blue', t: 'azul' }, { en: 'green', t: 'verde' }, { en: 'white', t: 'blanco' },
  { en: 'black', t: 'negro' }, { en: 'yellow', t: 'amarillo' },
];

beforeEach(() => {
  mockNav.goBack.mockClear();
  useLanguage.setState({ language: 'es-ES', level: 1, content: { 'es-ES': { basics: colours } }, progress: {}, xp: 0, streak: { day: '', count: 0 }, saved: {}, glossary: {}, memory: {} });
});

it('is solved by writing the Spanish for each English clue, and finishing marks the square done', async () => {
  mockParams = { unitId: 'basics', key: 'crossword@1.1' };
  const screen = render(<CrosswordScreen />);
  const grid = await screen.findByTestId('crossword-grid');
  expect(grid).toBeTruthy();
  const clues = screen.getAllByTestId(/^clue-/);
  expect(clues.length).toBeGreaterThanOrEqual(4);
  for (const clue of clues) {
    const en = /: (\w+), \d+ letters/.exec(clue.props.accessibilityLabel)![1];
    fireEvent.press(clue);
    // A wrong answer is refused first.
    fireEvent.changeText(screen.getByTestId('crossword-typed'), 'xx');
    fireEvent.press(screen.getByTestId('crossword-check'));
    expect(screen.getByText(/Not quite/)).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('crossword-typed'), colours.find((c) => c.en === en)!.t);
    fireEvent.press(screen.getByTestId('crossword-check'));
  }
  expect(await screen.findByTestId('crossword-done')).toBeTruthy();
  expect(languageService.isDone('crossword@1.1')).toBe(true);
});

it('can be skipped: the square is done and the board moves on', async () => {
  mockParams = { unitId: 'basics', key: 'crossword@1.1' };
  const screen = render(<CrosswordScreen />);
  await screen.findByTestId('crossword-grid');
  fireEvent.press(screen.getByTestId('crossword-skip'));
  expect(languageService.isDone('crossword@1.1')).toBe(true);
  expect(mockNav.goBack).toHaveBeenCalled();
  expect(useLanguage.getState().xp).toBe(0);
});

it('says how many lessons are left before the exam, and where the learner\'s row is', async () => {
  const spaces = boardFor(1);
  const onFocus = jest.fn();
  const screen = render(<Board spaces={spaces} isDone={() => false} isOpen={(i) => i === 0} current={0} onPress={() => undefined} onFocus={onFocus} />);
  expect(screen.getByTestId('board-exam-countdown').props.children.join('')).toBe('Exam in 8 lessons');
  fireEvent(screen.getByTestId('language-board'), 'layout', { nativeEvent: { layout: { y: 300, x: 0, width: 300, height: 900 } } });
  fireEvent(screen.getByTestId('board-squares'), 'layout', { nativeEvent: { layout: { y: 80, x: 0, width: 300, height: 800 } } });
  fireEvent(screen.getByTestId('board-row-0'), 'layout', { nativeEvent: { layout: { y: 40, x: 0, width: 300, height: 90 } } });
  await waitFor(() => expect(onFocus).toHaveBeenCalledWith(420));
  expect(onFocus).toHaveBeenCalledTimes(1);
});
