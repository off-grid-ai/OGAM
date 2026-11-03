import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { DuplicateChatsBanner } from '../../src/chats/DuplicateChatsBanner';
import { useChatStore } from '../../src/stores';

const chat = (id: string, content: string, ts: number) => ({
  id, title: 'Trip to Japan', modelId: 'm', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  messages: [{ id: `${id}-1`, role: 'user', content, timestamp: ts }],
}) as any;

it('offers to merge chats with the same title, and one tap leaves a single chat with all the messages', () => {
  useChatStore.setState({ conversations: [chat('a', 'Plan 5 days', 1), chat('b', 'Add Kyoto', 2)] });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = render(<DuplicateChatsBanner />);
  expect(view.getByText(/1 chat shares a title/)).toBeTruthy();
  fireEvent.press(view.getByTestId('duplicate-merge'));
  const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  buttons.find((b) => b.text === 'Merge')!.onPress!();
  const left = useChatStore.getState().conversations;
  expect(left).toHaveLength(1);
  expect(left[0].messages.map((m) => m.content)).toEqual(['Plan 5 days', 'Add Kyoto']);
  alert.mockRestore();
});
