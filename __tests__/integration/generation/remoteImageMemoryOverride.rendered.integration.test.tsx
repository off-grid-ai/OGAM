import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('remote image memory refusal in Chat', () => {
  const originalFetch = global.fetch;
  afterEach(async () => {
    global.fetch = originalFetch;
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    await remoteServerManager.clearAllServers();
  });

  it('routes a remote-only image, shows the server reason, and sends Run anyway only after a tap', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android' });
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    const { useRemoteServerStore } = require('../../../src/stores/remoteServerStore');
    const server = await remoteServerManager.addServer({
      name: 'Paired Desktop',
      endpoint: 'http://192.168.7.20:7881',
      providerType: 'openai-compatible',
      mediaModels: { image: 'remote-image' },
    });
    useRemoteServerStore.getState().setActiveRemoteMediaServerId('image', server.id);

    const requests: Array<Record<string, unknown>> = [];
    global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      requests.push(body);
      if (body.allow_unsafe_memory_override !== true) {
        return {
          ok: false,
          status: 507,
          text: async () => JSON.stringify({ error: { message: 'OFFGRID_IMAGE_MEMORY_LIMIT:Server needs more image memory.' } }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' }] }),
      } as Response;
    }) as typeof fetch;

    h.render();
    await h.cycleImageMode();
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
    await h.tapSend('a fox in snow');
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Server needs more image memory/)).not.toBeNull(); });
    expect(h.view!.queryByText('Run anyway')).not.toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.allow_unsafe_memory_override).not.toBe(true);

    h.rtl.fireEvent.press(h.view!.getByText('Run anyway'));
    await h.rtl.waitFor(() => { expect(requests.length).toBe(2); });
    expect(requests[1]?.allow_unsafe_memory_override).toBe(true);
  });

  it('shows an ordinary provider rejection without a memory override', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android' });
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    const { useRemoteServerStore } = require('../../../src/stores/remoteServerStore');
    const server = await remoteServerManager.addServer({
      name: 'Provider',
      endpoint: 'http://192.168.7.22:7881',
      providerType: 'openai-compatible',
      mediaModels: { image: 'remote-image' },
    });
    useRemoteServerStore.getState().setActiveRemoteMediaServerId('image', server.id);
    global.fetch = (async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { message: 'Provider quota exhausted.' } }),
    } as Response)) as typeof fetch;

    h.render();
    await h.cycleImageMode();
    await h.tapSend('a fox in snow');
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Provider quota exhausted/)).not.toBeNull(); });
    expect(h.view!.queryByText('Run anyway')).toBeNull();
  });
});

/**
 * Item 8 (handoff 2026-10-17, commit 218b48963): Off Grid AI Desktop runs an image as an async job. When
 * that JOB (not the HTTP submission) ends `failed` with Desktop's image memory guard, the chat shows the
 * reason in plain words (no `OFFGRID_IMAGE_MEMORY_LIMIT` prefix) and offers "Run anyway"; tapping it
 * resubmits with the memory override and the image appears in the chat.
 *
 * Fake: Desktop's gateway over fetch (harness/remoteImageServer serveDesktopImageJobs), in Desktop's own
 * wire shapes. The override is read where it crosses the boundary: the job Desktop received.
 */
describe.each([
  ['in the message, as Desktop sends it', false],
  ['as a structured error code', true],
])('a Desktop image job that fails for memory, code %s', (_form, failWithCode) => {
  const { serveDesktopImageJobs, chooseDesktopImageModel } =
    require('../../harness/remoteImageServer') as typeof import('../../harness/remoteImageServer');
  const REASON = 'Flux Schnell needs 9.2 GB of free memory. This Mac has 6.1 GB free.';
  let restore: (() => void) | undefined;
  afterEach(async () => {
    restore?.();
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    await remoteServerManager.clearAllServers();
  });

  it('shows the reason without the code, and Run anyway draws the image with the override', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android' });
    const desktop = serveDesktopImageJobs({ memoryReason: REASON, failWithCode });
    restore = desktop.restore;
    await chooseDesktopImageModel(h);
    const view = h.view!;

    // Before drawing: no image, no failure.
    expect(view.queryByTestId('generated-image')).toBeNull();
    expect(view.queryByText('Run anyway')).toBeNull();

    await h.tapSend('a lighthouse at dusk');

    // The job ran on Desktop, then failed: the reason shows in plain words, with no raw code anywhere.
    await h.rtl.waitFor(() => { expect(view.queryByText(REASON)).not.toBeNull(); }, { timeout: 8000 });
    expect(view.queryAllByText(/OFFGRID_IMAGE_MEMORY_LIMIT/)).toHaveLength(0);
    expect(view.queryByText('Run anyway')).not.toBeNull();
    expect(view.queryByTestId('generated-image')).toBeNull();
    expect(desktop.submissions).toHaveLength(1);
    expect(desktop.submissions[0]).toMatchObject({ async: true, prompt: 'a lighthouse at dusk' });
    expect(desktop.submissions[0].allow_unsafe_memory_override).toBeUndefined();

    h.rtl.fireEvent.press(view.getByText('Run anyway'));

    // The retry carries the override to Desktop, and the image appears in the chat.
    await h.rtl.waitFor(() => { expect(view.queryByTestId('generated-image')).not.toBeNull(); }, { timeout: 8000 });
    expect(desktop.submissions).toHaveLength(2);
    expect(desktop.submissions[1]).toMatchObject({ async: true, allow_unsafe_memory_override: true });
    expect(view.queryByText(REASON)).toBeNull();
    expect(view.queryByText('Run anyway')).toBeNull();
  }, 30000);
});
