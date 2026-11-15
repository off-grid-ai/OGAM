/**
 * The iOS Share → Improve link.
 *
 * SPEC: the Share extension opens its own build with `<bundle id>://improve`, so with a dev and a
 * release build on one phone the text reaches the build it was shared to. That link, and the older
 * `offgrid://improve`, open Improve on the shared text. Any other link into the app does not.
 *
 * The real App with Pro decided by a real licence, its real navigator and the real Improve screen.
 * Device boundaries only: the native Scribe entry module (the Share extension's hand-off), the OS
 * link events, and the boundaries the licensed app runs on (Keychain, SQLite, TCP, mDNS).
 */
import type { LicensedMesh } from '../../harness/licensedMesh';
import { proIsPresent } from '../../pro/helpers/requirePro';

jest.unmock('@react-navigation/native');

jest.mock('react-native-tcp-socket', () => ({
  __esModule: true,
  default: require('../../utils/nativeSyncBoundaries').createNativeTcpBoundary(),
}));
jest.mock('react-native-zeroconf', () => ({
  __esModule: true,
  default: require('../../utils/nativeSyncBoundaries').createNativeDiscoveryBoundary(),
}));
jest.mock('@op-engineering/op-sqlite', () =>
  require('../../harness/sqliteFake').realSqliteModule({ only: ['offgrid-sync.sqlite'] }),
);

type App = Awaited<ReturnType<typeof import('../../harness/proHarness').launchLicensedApp>>;
type LinkHandler = (event: { url: string }) => void;

const describePro = proIsPresent() ? describe : describe.skip;

/** The phone's side of Share: what the extension left for the app, and the OS opening links. */
interface SharePhone {
  /** The Share extension hands this text to the app and opens it with `url`. */
  share(text: string): void;
  openLink(url: string): void;
  /** How many times the app asked the native side for shared text. */
  takes(): number;
}

let mesh: LicensedMesh;
let app: App | undefined;

async function launchOnIPhone(): Promise<{ app: App; phone: SharePhone }> {
  const { launchLicensedApp } = require('../../harness/proHarness');
  let pending: { id: string; text: string; apply: 'copy' } | null = null;
  let takes = 0;
  const handlers: LinkHandler[] = [];
  const launched: App = await launchLicensedApp({
    mesh,
    secrets: new Map(),
    configure: () => {
      const RN = require('react-native');
      Object.defineProperty(RN.Platform, 'OS', { value: 'ios', configurable: true });
      RN.NativeModules.ScribeEntryModule = {
        takePending: async () => {
          takes += 1;
          const request = pending;
          pending = null;
          return request;
        },
        finish: async () => false,
      };
      RN.Linking.addEventListener = (type: string, handler: LinkHandler) => {
        if (type === 'url') handlers.push(handler);
        return { remove: () => handlers.splice(handlers.indexOf(handler), 1) };
      };
    },
  });
  app = launched;
  let shared = 0;
  const phone: SharePhone = {
    share: text => {
      shared += 1;
      pending = { id: `share-${shared}`, text, apply: 'copy' };
    },
    openLink: url => launched.rtl.act(() => {
      for (const handler of [...handlers]) handler({ url });
    }),
    takes: () => takes,
  };
  return { app: launched, phone };
}

describePro('Share → Improve link', () => {
  beforeEach(() => {
    const { createLicensedMesh } = require('../../harness/licensedMesh');
    mesh = createLicensedMesh();
    mesh.reset();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    mesh.restore();
    delete require('react-native').NativeModules.ScribeEntryModule;
  });

  it.each(['ai.offgridmobile.dev://improve', 'ai.offgridmobile://improve', 'offgrid://improve'])(
    '%s opens Improve on the shared text',
    async url => {
      const { app: { view }, phone } = await launchOnIPhone();

      phone.share('What we do:\n- Build in sprints');
      phone.openLink(url);

      expect(await view.findByTestId('improve-original')).toHaveTextContent('What we do:\n- Build in sprints');
    },
  );

  it('another link into the app does not take the shared text', async () => {
    const { app: { view }, phone } = await launchOnIPhone();
    const takesBefore = phone.takes();

    phone.share('What we do:');
    phone.openLink('offgrid://oauth/callback?code=1');

    expect(phone.takes()).toBe(takesBefore);
    expect(view.queryByTestId('improve-original')).toBeNull();
    // Still waiting for its own link, which opens it.
    phone.openLink('offgrid://improve');
    expect(await view.findByTestId('improve-original')).toHaveTextContent('What we do:');
  });
});
