/**
 * Pre-made stories and podcasts: the library lists fairy tales, funny everyday moments and
 * news, a Spanish piece opens with no model, and landing on a story square plays that
 * square's own piece and moves the token on when it is finished.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockNav = { navigate: jest.fn(), goBack: jest.fn() };
let mockParams: any = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
}));

import { ListeningScreen } from '../../../src/language/ListeningScreen';
import { useLanguage } from '../../../src/language/store';
import { languageService } from '../../../src/language/languageService';
import { boardFor } from '../../../src/language/board';
import { LIBRARY, pieceForSpace } from '../../../src/language/library';

beforeEach(() => useLanguage.setState({ language: 'es-ES', level: 1, progress: {}, listening: {}, myWords: {}, content: {} }));

/** Answers each part's question correctly and moves to the next part. */
function readThrough(screen: ReturnType<typeof render>) {
  const piece = useLanguage.getState().listening['es-ES'][0];
  for (const p of piece.parts) {
    if (p.question) fireEvent.press(screen.getByText(p.question.options[p.question.answer]));
    fireEvent.press(screen.getByTestId('listening-next'));
  }
}

it('lists pre-made fairy tales and funny everyday stories, and opens a Spanish one with no model', async () => {
  mockParams = { kind: 'story' };
  const screen = render(<ListeningScreen />);
  expect(screen.getByTestId('library-fairy')).toBeTruthy();
  expect(screen.getByTestId('library-daily')).toBeTruthy();
  expect(screen.getByTestId('listening-make')).toBeTruthy();
  fireEvent.press(screen.getByTestId('piece-three-pigs'));
  expect(await screen.findByText('Los tres cerditos')).toBeTruthy();
  readThrough(screen);
  expect(screen.getByTestId('listening-vocab')).toBeTruthy();
  expect(screen.getByText('lobo')).toBeTruthy();
});

it('has over a hundred pre-made pieces, with a dozen written out in Spanish that open with no model', async () => {
  const { WRITTEN_ES } = require('../../../src/language/libraryEs');
  expect(LIBRARY.length).toBeGreaterThanOrEqual(100);
  expect(Object.keys(WRITTEN_ES).length).toBeGreaterThanOrEqual(12);
  // Every written piece is in the library, has questions with valid answers, and new words.
  for (const [id, piece] of Object.entries<any>(WRITTEN_ES)) {
    expect(LIBRARY.find((x) => x.id === id)?.kind).toBe(piece.kind);
    for (const part of piece.parts) expect(part.question.answer).toBeLessThan(part.question.options.length);
    expect(piece.vocab.length).toBeGreaterThan(5);
  }
  mockParams = { kind: 'podcast' };
  const screen = render(<ListeningScreen />);
  fireEvent.press(screen.getByTestId('piece-holidays'));
  expect(await screen.findByText('Las últimas vacaciones')).toBeTruthy();
  // A podcast is for listening: it plays by itself and keeps the text hidden until asked for.
  const firstLine: string = WRITTEN_ES.holidays.parts[0].lines[0].t;
  expect(screen.getByTestId('listening-audio-only')).toBeTruthy();
  expect(screen.queryByText(new RegExp(firstLine.split(' ')[0]))).toBeNull();
  fireEvent.press(screen.getByTestId('listening-show-text'));
  expect(screen.queryByTestId('listening-audio-only')).toBeNull();
});

it('offers made-up, historical and real news among the podcasts', () => {
  mockParams = { kind: 'podcast' };
  const screen = render(<ListeningScreen />);
  expect(screen.getByTestId('library-news-fake')).toBeTruthy();
  expect(screen.getByTestId('library-news-history')).toBeTruthy();
  expect(screen.getByTestId('library-news-real')).toBeTruthy();
});

it('lands a story square on its own pre-made piece and marks the square done at the end', async () => {
  const square = boardFor(1).find((s) => s.kind === 'story')!;
  expect(pieceForSpace(1, square.key)?.id).toBe(LIBRARY.find((x) => x.kind === 'story' && x.level === 1)!.id);
  mockParams = { kind: 'story', space: square.key, level: 1 };
  const screen = render(<ListeningScreen />);
  expect(await screen.findByText('Los tres cerditos')).toBeTruthy();
  expect(languageService.isDone(square.key)).toBe(false);
  readThrough(screen);
  expect(languageService.isDone(square.key)).toBe(true);
  expect(screen.getByTestId('listening-board')).toBeTruthy();
});
