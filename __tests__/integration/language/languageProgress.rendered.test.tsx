/**
 * Weekly progress and the word book: after a lesson the board shows this week's XP and
 * lessons, and the word book lists the words learned with their meaning, how well they are
 * known and when they come back; it searches in both languages.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockNav = { navigate: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: {} }),
}));

import { LanguageScreen } from '../../../src/language/LanguageScreen';
import { WordBookScreen } from '../../../src/language/WordBookScreen';
import { useLanguage } from '../../../src/language/store';
import { languageService } from '../../../src/language/languageService';

const colours = [{ en: 'red', t: 'rojo' }, { en: 'blue', t: 'azul' }, { en: 'green', t: 'verde' }];

beforeEach(() => useLanguage.setState({
  language: 'es-ES', level: 1, content: { 'es-ES': { colors: colours } }, progress: {}, memory: {}, history: {}, myWords: {}, xp: 0,
}));

it('shows this week on the board and the learned words in the word book', () => {
  languageService.finishLesson('colors', { right: 2, total: 3, results: [{ t: 'rojo', right: true }, { t: 'azul', right: false }, { t: 'verde', right: true }] });
  const board = render(<LanguageScreen />);
  expect(board.getByTestId('language-week-total').props.children.join('')).toBe('This week: 20 XP, 1 lesson');
  fireEvent.press(board.getByTestId('language-wordbook'));
  expect(mockNav.navigate).toHaveBeenCalledWith('WordBook');

  const book = render(<WordBookScreen />);
  expect(book.getByText('3 words')).toBeTruthy();
  // Missed words are due now; known ones come back later.
  expect(book.getByTestId('word-azul').findByProps({ children: 'Due now' })).toBeTruthy();
  expect(book.getByTestId('word-rojo').findByProps({ children: 'Due tomorrow' })).toBeTruthy();
  fireEvent.press(book.getByTestId('wordbook-sort-due'));
  expect(book.getAllByTestId(/^word-/)[0].props.testID).toBe('word-azul');
  fireEvent.changeText(book.getByTestId('wordbook-search'), 'gree');
  expect(book.getByText('verde')).toBeTruthy();
  expect(book.queryByText('rojo')).toBeNull();
});
