/**
 * Home's Recent rows: one line each, the chat's title and when, as on Chats. No reply preview and no
 * chevron (Mac, 2026-11-07: the two-line chat rows read like a settings screen).
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RecentConversations } from '../../../src/screens/HomeScreen/components/RecentConversations';
import { formatWhen } from '../../../src/utils/localTime';
import type { Conversation } from '../../../src/types';

const at = '2026-11-07T09:30:00.000Z';
const chat = (id: string, title: string, reply: string): Conversation =>
  ({
    id,
    title,
    createdAt: at,
    updatedAt: at,
    modelId: 'test-model',
    messages: [
      { id: `${id}-u`, role: 'user', content: title, timestamp: Date.parse(at) },
      { id: `${id}-a`, role: 'assistant', content: reply, timestamp: Date.parse(at) },
    ],
  }) as unknown as Conversation;

const renderRecent = (opened: string[]) =>
  render(
    <RecentConversations
      conversations={[chat('a', '[test] Name a fruit.', 'Hello! How can I help you today?'), chat('b', '[test] Count to five.', '1, 2, 3, 4, 5')]}
      totalCount={2}
      focusTrigger={0}
      onContinueChat={id => opened.push(id)}
      onDeleteConversation={() => undefined}
      onSeeAll={() => undefined}
    />,
  );

describe('RecentConversations', () => {
  it('shows each chat as one line: its title and when, with no reply preview', () => {
    const ui = renderRecent([]);
    expect(ui.getByText('[test] Name a fruit.')).toBeTruthy();
    expect(ui.getByText('[test] Count to five.')).toBeTruthy();
    expect(ui.getAllByText(formatWhen(at))).toHaveLength(2);
    expect(ui.queryByText('Hello! How can I help you today?')).toBeNull();
    expect(ui.queryByText('1, 2, 3, 4, 5')).toBeNull();
    expect(ui.getByText('[test] Name a fruit.').props.numberOfLines).toBe(1);
  });

  it('opens the chat that was tapped', () => {
    const opened: string[] = [];
    const ui = renderRecent(opened);
    fireEvent.press(ui.getByTestId('conversation-item-1'));
    expect(opened).toEqual(['b']);
  });
});
