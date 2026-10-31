/** The real chat screen keeps a remote reply open while its model socket is still streaming. */
import { setupChatScreen } from '../../harness/chatHarness';
import { installRemoteModel, installRemoteStream } from '../../harness/remoteHarness';

const SLOW_REPLY =
  'data: {"choices":[{"delta":{"content":"Still working"}}]}\n\n' +
  '__PAUSE__\n' +
  'data: {"choices":[{"delta":{"content":" — finished."}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

describe('slow remote reply in the chat UI', () => {
  it('stays in progress until the remote model completes', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    await installRemoteModel();
    const upstream = installRemoteStream(SLOW_REPLY);
    h.render();

    await h.tapSend('Take your time');
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Still working/)).not.toBeNull();
      expect(h.view!.queryByTestId('stop-button')).not.toBeNull();
    });

    await h.settle(50);
    // The model's stream ends here: await its last chunk and done, then the reply leaves its in-progress state.
    await h.rtl.act(() => upstream.release());
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Still working — finished\./)).not.toBeNull();
      expect(h.view!.queryByTestId('stop-button')).toBeNull();
    });
  });

  it('keeps a draft and the Projects screen usable while a reply streams', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    await installRemoteModel();
    const upstream = installRemoteStream(SLOW_REPLY);
    h.render();

    await h.tapSend('Take your time');
    await h.rtl.waitFor(() => {
      expect(h.view!.getByText(/Still working/)).toBeTruthy();
    });

    h.rtl.fireEvent.changeText(h.view!.getByTestId('chat-input'), 'Next question');
    expect(h.view!.getByTestId('chat-input').props.value).toBe('Next question');

    const { ProjectEditScreen } = require('../../../src/screens/ProjectEditScreen');
    const { ProjectsScreen } = require('../../../src/screens/ProjectsScreen');
    const editor = h.rtl.render(h.React.createElement(ProjectEditScreen));
    h.rtl.fireEvent.changeText(editor.getByTestId('project-edit-name'), 'Research');
    h.rtl.fireEvent.changeText(editor.getByTestId('project-edit-system-prompt'), 'Help with research.');
    h.rtl.fireEvent.press(editor.getByTestId('project-edit-save'));
    editor.unmount();

    const projects = h.rtl.render(h.React.createElement(ProjectsScreen));
    expect(projects.getByText('Research')).toBeTruthy();
    expect(h.view!.getByText(/Still working/)).toBeTruthy();

    upstream.release();
    await h.rtl.waitFor(() => {
      expect(h.view!.getByText(/Still working — finished\./)).toBeTruthy();
      expect(h.view!.getByTestId('chat-input').props.value).toBe('Next question');
    });
    projects.unmount();
  });

  it('saves an edited message and shows the new reply', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await h.send('First question', { text: 'First answer' });
    await h.rtl.waitFor(() => expect(h.view!.getByText('First answer')).toBeTruthy());

    await h.editLastUserMessage('Revised question', { text: 'Revised answer' });
    await h.rtl.waitFor(() => {
      expect(h.view!.getByText('Revised question')).toBeTruthy();
      expect(h.view!.getByText('Revised answer')).toBeTruthy();
      expect(h.view!.queryByText('First answer')).toBeNull();
    });
  });
});
