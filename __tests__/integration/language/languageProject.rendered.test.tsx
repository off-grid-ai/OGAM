/**
 * The language course lives in the Learn a language project (the old Spanish Learning
 * project): pick a language there and the project's chats follow it. Story mode reads easy
 * text part by part, asks a question after each part, then offers the new words, which become
 * the My words lesson. The model's story is checked before it is used.
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

import { LanguageCourseCard } from '../../../src/language/LanguageCourseCard';
import { ListeningScreen } from '../../../src/language/ListeningScreen';
import { useLanguage } from '../../../src/language/store';
import { useProjectStore } from '../../../src/stores/projectStore';
import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { LanguageScreen } from '../../../src/language/LanguageScreen';
import { createDownloadedModel } from '../../utils/factories';
import { knownSet, parseListening } from '../../../src/language/listening';
import { MY_WORDS, languageService } from '../../../src/language/languageService';

const story = {
  title: 'El perro', parts: [
    { lines: [{ t: 'Tengo un perro.', en: 'I have a dog.' }], question: { q: 'What does the person have?', options: ['A cat', 'A dog'], answer: 1 } },
    { lines: [{ t: 'El perro come pan.', en: 'The dog eats bread.' }], question: { q: 'What does the dog eat?', options: ['Bread', 'Fish'], answer: 0 } },
  ],
  vocab: [{ t: 'perro', en: 'dog' }, { t: 'come', en: 'eats' }, { t: 'pan', en: 'bread' }, { t: 'tengo', en: 'I have' }, { t: 'agua', en: 'water' }],
};

beforeEach(() => useLanguage.setState({ language: 'es-ES', content: {}, progress: {}, xp: 0, streak: { day: '', count: 0 }, listening: {}, myWords: {} }));

it('is the Learn a language project, and changing the language changes its chats', () => {
  const project = useProjectStore.getState().getProject('spanish-learning')!;
  expect(project.name).toBe('Learn a language');
  expect(project.course).toBe('language');
  const card = render(<LanguageCourseCard />);
  expect(card.getByText('Learning Spanish')).toBeTruthy();
  fireEvent.press(card.getByLabelText('Learn French'));
  expect(card.getByText('Learning French')).toBeTruthy();
  expect(useProjectStore.getState().getProject('spanish-learning')!.systemPrompt).toMatch(/patient French tutor/);
  fireEvent.press(card.getByTestId('course-story'));
  expect(mockNav.navigate).toHaveBeenCalledWith('Listening', { kind: 'story' });
});

it('reads a story with questions, then saves the new words for My words practice', () => {
  // "agua" was learned already in Food and drink, so it is not offered as new.
  useLanguage.setState({ content: { 'es-ES': { food: [{ en: 'water', t: 'agua' }] } }, progress: { 'es-ES': { food: { stars: 2, lessons: 1 } } } });
  const piece = parseListening(JSON.stringify(story), 'story', knownSet(languageService.knownItems()))!;
  expect(piece.vocab.map((v) => v.t)).toEqual(['perro', 'come', 'pan', 'tengo']);
  useLanguage.setState({ listening: { 'es-ES': [piece] } });
  mockParams = { kind: 'story', at: piece.createdAt };

  const screen = render(<ListeningScreen />);
  expect(screen.getByText('Tengo un perro.')).toBeTruthy();
  expect(screen.getByTestId('listening-next').props.accessibilityState?.disabled).toBe(true);
  fireEvent.press(screen.getByText('Show English'));
  expect(screen.getByText('I have a dog.')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('A dog'));
  fireEvent.press(screen.getByTestId('listening-next'));
  fireEvent.press(screen.getByLabelText('Bread'));
  fireEvent.press(screen.getByTestId('listening-next'));

  expect(screen.getByTestId('listening-vocab')).toBeTruthy();
  fireEvent.press(screen.getByTestId('listening-save'));
  expect(screen.getByText('4 new words added to My words.')).toBeTruthy();
  expect(languageService.unlocked(MY_WORDS)).toBe(true);
  fireEvent.press(screen.getByText('Practise My words'));
  expect(mockNav.navigate).toHaveBeenCalledWith('Lesson', { unitId: MY_WORDS });
});

it('refuses a story that is not in the expected shape', () => {
  expect(parseListening('{"parts": [{"lines": [{"t": "Hola"}]}]}', 'story', new Set())).toBeNull();
  expect(parseListening('not json', 'podcast', new Set())).toBeNull();
});

it('opens a tutor chat from the Learn a language screen, which keeps the tutor\'s chats in the course project', () => {
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm' })], activeModelId: 'llm' });
  const before = useChatStore.getState().conversations.length;
  const screen = render(<LanguageScreen />);
  fireEvent.press(screen.getByTestId('language-tutor'));
  const made = useChatStore.getState().conversations;
  expect(made).toHaveLength(before + 1);
  expect(made[made.length - 1].projectId).toBe('spanish-learning');
  expect(mockNav.navigate).toHaveBeenCalledWith('Chat', { conversationId: made[made.length - 1].id, projectId: 'spanish-learning' });
  fireEvent.press(screen.getByTestId('language-chats'));
  expect(mockNav.navigate).toHaveBeenCalledWith('ProjectChats', { projectId: 'spanish-learning' });
});
