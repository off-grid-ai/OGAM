/**
 * Project types: choosing School or Work fills in starting instructions (without overwriting the person's own),
 * saves the type, and the project page then offers quick starts that open a chat with the request already typed.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockNav = { navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) };
let mockParams: any = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
  useFocusEffect: jest.fn(),
  useIsFocused: () => true,
}));

import { ProjectEditScreen } from '../../../src/screens/ProjectEditScreen';
import { ProjectDetailScreen } from '../../../src/screens/ProjectDetailScreen';
import { useProjectStore } from '../../../src/stores/projectStore';
import { useAppStore } from '../../../src/stores/appStore';
import { PROJECT_TYPES, isStarterInstructions } from '../../../src/projects/projectTypes';
import { createDownloadedModel } from '../../utils/factories';

beforeEach(() => { mockNav.navigate.mockClear(); mockNav.goBack.mockClear(); mockParams = {}; });

it('fills in the starting instructions for the chosen type, but never over the person\'s own, and saves the type', () => {
  const screen = render(<ProjectEditScreen />);
  fireEvent.press(screen.getByTestId('project-type-school'));
  expect(screen.getByDisplayValue(PROJECT_TYPES[1].instructions)).toBeTruthy();
  // Switching type while the text is still a starter swaps it.
  fireEvent.press(screen.getByTestId('project-type-work'));
  expect(screen.getByDisplayValue(PROJECT_TYPES[2].instructions)).toBeTruthy();
  // Their own words are kept.
  fireEvent.changeText(screen.getByDisplayValue(PROJECT_TYPES[2].instructions), 'Always answer in French.');
  fireEvent.press(screen.getByTestId('project-type-school'));
  expect(screen.getByDisplayValue('Always answer in French.')).toBeTruthy();

  fireEvent.changeText(screen.getByPlaceholderText('e.g., Spanish Learning, Code Review'), 'Biology');
  fireEvent.press(screen.getByText('Save'));
  const made = useProjectStore.getState().projects.find((p) => p.name === 'Biology')!;
  expect(made.kind).toBe('school');
  expect(made.systemPrompt).toBe('Always answer in French.');
});

it('offers quick starts on a School project that open a new chat with the request typed', () => {
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'm1' })], activeModelId: 'm1' });
  const project = useProjectStore.getState().createProject({ name: 'Chemistry', description: '', systemPrompt: '', kind: 'school' });
  mockParams = { projectId: project.id };
  const screen = render(<ProjectDetailScreen />);
  expect(screen.getByTestId('project-quick-starts')).toBeTruthy();
  fireEvent.press(screen.getByTestId('project-start-quiz-me'));
  const call = mockNav.navigate.mock.calls.find((c) => c[0] === 'Chat')!;
  expect(call[1].projectId).toBe(project.id);
  expect(call[1].starter).toMatch(/Quiz me on my documents/);
});

it('has no quick starts on a general project', () => {
  const project = useProjectStore.getState().createProject({ name: 'Notes', description: '', systemPrompt: '' });
  mockParams = { projectId: project.id };
  const screen = render(<ProjectDetailScreen />);
  expect(screen.queryByTestId('project-quick-starts')).toBeNull();
});

it('treats empty text and a type\'s own starting text as replaceable, anything else as the person\'s', () => {
  expect(isStarterInstructions('')).toBe(true);
  expect(isStarterInstructions(PROJECT_TYPES[1].instructions)).toBe(true);
  expect(isStarterInstructions('Answer in French.')).toBe(false);
});

it('puts a quick start in the message box for the person to edit and send', () => {
  const { ChatInput } = require('../../../src/components/ChatInput');
  const box = render(<ChatInput onSend={jest.fn()} starterText="Quiz me on my documents." />);
  expect(box.getByTestId('chat-input').props.value).toBe('Quiz me on my documents.');
});
