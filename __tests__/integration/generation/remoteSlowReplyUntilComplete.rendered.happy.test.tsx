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
    upstream.release();
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Still working — finished\./)).not.toBeNull();
      expect(h.view!.queryByTestId('stop-button')).toBeNull();
    });
  });
});
