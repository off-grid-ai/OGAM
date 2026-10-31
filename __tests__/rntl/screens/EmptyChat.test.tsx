/**
 * A new chat names the model it will talk to, and with no model chosen it names none (never "Unknown").
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { EmptyChat } from '../../../src/screens/ChatScreen/ChatScreenComponents';

const hint = (props: { activeModel?: { name: string }; activeModelName?: string }) => {
  const view = render(
    <EmptyChat
      styles={{} as any}
      colors={{ textMuted: '#999' } as any}
      activeModel={props.activeModel}
      activeModelName={props.activeModelName}
      activeProject={null}
      setShowProjectSelector={jest.fn()}
    />,
  );
  return String(view.getByTestId('empty-chat-hint').props.children);
};

describe('EmptyChat', () => {
  it('names the chosen model', () => {
    expect(hint({ activeModelName: 'Qwen 3' })).toContain('Qwen 3');
    expect(hint({ activeModel: { name: 'Gemma 4' } })).toContain('Gemma 4');
  });

  it('names no model when none is chosen', () => {
    expect(hint({})).not.toMatch(/Unknown|chatting with/);
  });
});
