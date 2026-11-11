/**
 * The chat's long-press menu can save the conversation as a Markdown file where the person picks
 * (the picker is the device boundary here; the file it is handed is read back and checked).
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

const mockSaved: { fileName: string; text: string }[] = [];
jest.mock('@react-native-documents/picker', () => ({
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  saveDocuments: jest.fn(async ({ sourceUris, fileName }: { sourceUris: string[]; fileName: string }) => {
    const RNFS = require('react-native-fs');
    mockSaved.push({ fileName, text: await RNFS.readFile(sourceUris[0].replace('file://', ''), 'utf8') });
    return [{ name: fileName }];
  }),
  isErrorWithCode: () => false,
}));

it('saves a chat as a Markdown or a plain text file named after it', async () => {
  installNativeBoundary({ fs: true });
  const rtl = requireRTL();
  const React = require('react');
  const { useChatOptions } = require('../../../src/components/ChatOptions');

  const chat = {
    id: 'c1', title: 'Trip: Spain / 2026', createdAt: '', updatedAt: '', modelId: 'm',
    messages: [
      { id: '1', role: 'user', content: 'Plan three days in Madrid.', timestamp: 1 },
      { id: '2', role: 'assistant', content: 'Day 1: the Prado.', timestamp: 2 },
    ],
  };
  const Host = () => {
    const { open, element } = useChatOptions();
    return React.createElement(React.Fragment, null, React.createElement(require('react-native').TouchableOpacity, { testID: 'open', onPress: () => open(chat) }), element);
  };
  const screen = rtl.render(React.createElement(Host));
  rtl.fireEvent.press(screen.getByTestId('open'));
  rtl.fireEvent.press(await screen.findByTestId('chat-option-save-as-markdown'));
  await rtl.waitFor(() => expect(mockSaved).toHaveLength(1));
  expect(mockSaved[0].fileName).toBe('Trip Spain 2026.md');
  expect(mockSaved[0].text).toContain('# Trip: Spain / 2026');
  expect(mockSaved[0].text).toContain('**You:** Plan three days in Madrid.');
  expect(mockSaved[0].text).toContain('**Atlas:** Day 1: the Prado.');

  // The same menu saves a plain .txt without the Markdown marks.
  rtl.fireEvent.press(screen.getByTestId('open'));
  rtl.fireEvent.press(await screen.findByTestId('chat-option-save-as-text-file'));
  await rtl.waitFor(() => expect(mockSaved).toHaveLength(2));
  expect(mockSaved[1].fileName).toBe('Trip Spain 2026.txt');
  expect(mockSaved[1].text).toBe('Trip: Spain / 2026\n\nYou: Plan three days in Madrid.\n\nAtlas: Day 1: the Prado.\n');
});
