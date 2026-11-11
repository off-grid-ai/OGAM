/**
 * Each chat keeps its own tools: turning Calendar on in one chat and Web search in another does
 * not change the other chat, a chat starts from its agent's default tools, and "use the default
 * tools again" returns to them. The tools a turn sends are the same ones the chat shows.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

let mockParams: any = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));

import { ToolsScreen } from '../../../src/screens/ToolsScreen';
import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { toolsForConversation } from '../../../src/services/tools/chatTools';

const conv = (id: string) => useChatStore.getState().conversations.find((c) => c.id === id);
const toggle = (screen: any, toolId: string) =>
  fireEvent(screen.getByTestId(`tool-picker-row-${toolId}`).findByType(require('react-native').Switch), 'valueChange', true);

beforeEach(() => {
  useAppStore.getState().updateSettings({ enabledTools: ['web_search'] });
  useChatStore.setState({ conversations: [
    { id: 'plans', title: 'Plans', modelId: 'm', messages: [], createdAt: 'x', updatedAt: 'x' },
    { id: 'research', title: 'Research', modelId: 'm', messages: [], createdAt: 'x', updatedAt: 'x' },
    { id: 'phone', title: 'Phone', modelId: 'm', messages: [], createdAt: 'x', updatedAt: 'x', agentId: 'phone-assistant' },
  ] as any });
});

it('changes the tools of one chat only', () => {
  mockParams = { conversationId: 'plans' };
  const screen = render(<ToolsScreen />);
  expect(screen.getByText('Tools for this chat')).toBeTruthy();
  toggle(screen, 'calendar_events');
  toggle(screen, 'web_search');
  expect(toolsForConversation(conv('plans'))).toEqual(['calendar_events']);
  expect(toolsForConversation(conv('research'))).toEqual(['web_search']);
  expect(useAppStore.getState().settings.enabledTools).toEqual(['web_search']);
  expect(screen.getByText('This chat has its own tools. Other chats are not changed.')).toBeTruthy();

  fireEvent.press(screen.getByTestId('tools-reset'));
  expect(toolsForConversation(conv('plans'))).toEqual(['web_search']);
});

it("starts an agent's chat from that agent's tools", () => {
  mockParams = { conversationId: 'phone' };
  const screen = render(<ToolsScreen />);
  expect(screen.getByText(/Using Phone Assistant's default tools/)).toBeTruthy();
  expect(toolsForConversation(conv('phone'))).toContain('add_calendar_event');
  expect(toolsForConversation(conv('phone'))).not.toContain('web_search');
});

it('from Settings, edits the defaults new chats start with', () => {
  mockParams = undefined;
  const screen = render(<ToolsScreen />);
  expect(screen.getByText('Default tools')).toBeTruthy();
  toggle(screen, 'calculator');
  expect(useAppStore.getState().settings.enabledTools).toEqual(['web_search', 'calculator']);
  expect(toolsForConversation(conv('research'))).toEqual(['web_search', 'calculator']);
});
