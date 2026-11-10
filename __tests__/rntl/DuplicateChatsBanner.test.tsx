import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { DuplicateChatsBanner } from '../../src/chats/DuplicateChatsBanner';
import { useChatStore } from '../../src/stores';
import { useAgentStore } from '../../src/stores/agentStore';

const chat = (id: string, content: string, ts: number, extra: object = {}) => ({
  id, title: 'Trip to Japan', modelId: 'm', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  messages: [{ id: `${id}-1`, role: 'user', content, timestamp: ts }], ...extra,
}) as any;

describe('merging chats with the same title', () => {
  beforeEach(() => useAgentStore.setState({ activeAgentId: null }));

  it('shows each chat (agent, size, last line) in a review sheet before anything is merged', () => {
    useChatStore.setState({ conversations: [chat('a', 'Plan 5 days', 1, { agentId: 'teacher' }), chat('b', 'Add Kyoto', 2)] });
    const view = render(<DuplicateChatsBanner />);
    expect(view.getByText(/1 chat shares a title/)).toBeTruthy();
    fireEvent.press(view.getByTestId('duplicate-merge'));
    expect(view.getByText(/2 chats become one with 2 messages/)).toBeTruthy();
    expect(view.getByText(/1 messages · Teacher · No project/)).toBeTruthy();
    expect(view.getByText(/1 messages · No agent · No project/)).toBeTruthy();
    expect(view.getByText(/"Add Kyoto"/)).toBeTruthy();
    expect(useChatStore.getState().conversations).toHaveLength(2); // nothing merged yet
  });

  it('merges one set, keeping the agent chosen for the merged chat, with all messages in time order', () => {
    useChatStore.setState({ conversations: [chat('a', 'Plan 5 days', 1, { agentId: 'teacher' }), chat('b', 'Add Kyoto', 2)] });
    const view = render(<DuplicateChatsBanner />);
    fireEvent.press(view.getByTestId('duplicate-merge'));
    fireEvent.press(view.getByTestId('merge-agent-friend'));
    fireEvent.press(view.getByTestId('merge-this-a'));
    const left = useChatStore.getState().conversations;
    expect(left).toHaveLength(1);
    expect(left[0].agentId).toBe('friend');
    expect(left[0].messages.map((m) => m.content)).toEqual(['Plan 5 days', 'Add Kyoto']);
  });

  it('keeps the settings of the chat picked, and no agent when that is chosen', () => {
    useChatStore.setState({ conversations: [chat('a', 'Plan 5 days', 1, { agentId: 'teacher', projectId: 'p1' }), chat('b', 'Add Kyoto', 2, { projectId: 'p2' })] });
    const view = render(<DuplicateChatsBanner />);
    fireEvent.press(view.getByTestId('duplicate-merge'));
    fireEvent.press(view.getByTestId('merge-base-b'));
    fireEvent.press(view.getByTestId('merge-agent-none'));
    fireEvent.press(view.getByTestId('merge-this-a'));
    const [merged] = useChatStore.getState().conversations;
    expect(merged.projectId).toBe('p2');
    expect(merged.agentId).toBeUndefined();
  });
});
