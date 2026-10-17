/**
 * The centered alert's title, message and buttons each reach a screen reader on their own. The
 * backdrop and the card are tap targets, and a tap target is one accessibility element by default,
 * which used to fold the whole alert into a single node that VoiceOver/TalkBack and automation could
 * not read into.
 *
 * Real CenteredAlert (no mocks), opened and answered the way a caller does it.
 */
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { CenteredAlert } from '../../../src/components/CenteredAlert';
import { accessibilityElementFor } from '../../utils/screenReader';

function DeleteChatRow() {
  const [open, setOpen] = React.useState(false);
  const [deleted, setDeleted] = React.useState(false);
  return (
    <>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Delete chat" onPress={() => setOpen(true)}>
        <Text>{deleted ? 'Chat deleted' : 'Trip plans'}</Text>
      </TouchableOpacity>
      <CenteredAlert
        visible={open}
        title="Delete chat?"
        message="This removes the chat and its images."
        buttons={[
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => setDeleted(true) },
        ]}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

describe('CenteredAlert', () => {
  it('lets a screen reader reach the title, the message and each button, announced as a button', () => {
    const ui = render(<DeleteChatRow />);

    // Before: no alert is on screen.
    expect(ui.queryByText('Delete chat?')).toBeNull();

    fireEvent.press(ui.getByRole('button', { name: 'Delete chat' }));

    const title = ui.getByText('Delete chat?');
    const message = ui.getByText('This removes the chat and its images.');
    const cancel = ui.getByRole('button', { name: 'Cancel' });
    const remove = ui.getByRole('button', { name: 'Delete' });
    // Each stop reads only its own words, never the whole alert as one block.
    expect(accessibilityElementFor(title)).toHaveTextContent('Delete chat?', { exact: true });
    expect(accessibilityElementFor(message)).toHaveTextContent('This removes the chat and its images.', { exact: true });
    expect(accessibilityElementFor(cancel)).toHaveTextContent('Cancel', { exact: true });
    expect(accessibilityElementFor(remove)).toHaveTextContent('Delete', { exact: true });

    fireEvent.press(remove);

    expect(ui.queryByText('Delete chat?')).toBeNull();
    expect(ui.getByText('Chat deleted')).toBeTruthy();
  });
});
