/**
 * The iOS Share → Improve link.
 *
 * SPEC: the Share extension opens its own build with `<bundle id>://improve`, so with a dev and a
 * release build on one phone the text reaches the build it was shared to. That link, and the older
 * `offgrid://improve`, open Improve on the shared text. Any other link into the app does not.
 *
 * Device boundaries only: the native Scribe entry module and the OS link events.
 */
import { Linking, NativeModules, Platform } from 'react-native';

type LinkHandler = (event: { url: string }) => void;

function load(pendingText: string) {
  let pending: { id: string; text: string; apply: 'copy' } | null = null;
  NativeModules.ScribeEntryModule = {
    takePending: jest.fn(async () => {
      const request = pending;
      pending = null;
      return request;
    }),
    finish: jest.fn(async () => false),
  };
  const handlers: LinkHandler[] = [];
  jest.spyOn(Linking, 'addEventListener').mockImplementation(((_: string, handler: LinkHandler) => {
    handlers.push(handler);
    return { remove: () => undefined };
  }) as never);
  let entry!: typeof import('../../../src/services/scribeEntry');
  jest.isolateModules(() => {
    entry = require('../../../src/services/scribeEntry');
  });
  const navigate = jest.fn();
  entry.startScribeEntry({ isReady: () => true, navigate, hasRoute: () => true });
  const share = () => {
    pending = { id: 'r1', text: pendingText, apply: 'copy' };
  };
  const openLink = async (url: string) => {
    for (const handler of handlers) handler({ url });
    await new Promise(resolve => setImmediate(resolve));
  };
  return { navigate, share, openLink };
}

describe('Share → Improve link', () => {
  const originalOS = Platform.OS;
  beforeAll(() => {
    Platform.OS = 'ios';
  });
  afterAll(() => {
    Platform.OS = originalOS;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete NativeModules.ScribeEntryModule;
  });

  it.each(['ai.offgridmobile.dev://improve', 'ai.offgridmobile://improve', 'offgrid://improve'])(
    '%s opens Improve on the shared text',
    async url => {
      const { navigate, share, openLink } = load('What we do:\n- Build in sprints');
      await new Promise(resolve => setImmediate(resolve));
      share();
      await openLink(url);
      expect(navigate).toHaveBeenCalledWith('ScribeImprove', {
        text: 'What we do:\n- Build in sprints',
        apply: 'copy',
      });
    },
  );

  it('another link into the app does not take the shared text', async () => {
    const { navigate, share, openLink } = load('What we do:');
    await new Promise(resolve => setImmediate(resolve));
    share();
    await openLink('offgrid://oauth/callback?code=1');
    expect(navigate).not.toHaveBeenCalled();
  });
});
