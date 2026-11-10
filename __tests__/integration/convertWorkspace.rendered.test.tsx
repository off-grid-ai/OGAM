/** Chat settings > Convert the Atlas workspace folder to Markdown files: converts and says where the files went. */
import { installNativeBoundary, requireRTL } from '../harness/nativeBoundary';

jest.mock('../../src/atlasTools/deviceTools', () => ({ workspaceDir: async () => '/ws' }));

it('converts the workspace and tells the person where the .md files are', async () => {
  installNativeBoundary({ fs: true });
  const rtl = requireRTL();
  const React = require('react');
  const RNFS = require('react-native-fs');
  const { Alert } = require('react-native');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const { useChatStore } = require('../../src/stores');
  useChatStore.getState().createConversation('model-1');
  RNFS.readDir.mockImplementation(async () => [{ name: 'page.html', path: '/ws/page.html', isDirectory: () => false }]);
  RNFS.readFile.mockImplementation(async () => '<h1>Top</h1>');
  RNFS.writeFile.mockResolvedValue(undefined);
  RNFS.mkdir.mockResolvedValue(undefined);
  const { ChatContextSection } = require('../../src/components/GenerationSettingsModal/ChatContextSection');
  const view = rtl.render(React.createElement(ChatContextSection));
  await rtl.act(async () => { rtl.fireEvent.press(view.getByTestId('convert-workspace')); });
  await rtl.waitFor(() => expect(alert).toHaveBeenCalled());
  expect(alert.mock.calls[0][1]).toBe('1 converted, saved in /ws/Converted');
  expect(RNFS.writeFile).toHaveBeenCalledWith('/ws/Converted/page.md', expect.stringContaining('# Top'), 'utf8');
  alert.mockRestore();
});
