/**
 * The iOS Share → Improve link.
 *
 * SPEC: the Share extension opens its own build with `<bundle id>://improve?text=<shared text>`, so
 * with a dev and a release build on one phone the text reaches the build it was shared to. The text
 * travels in the link because iOS keeps a named pasteboard from a share extension. That link, and the
 * older `offgrid://improve`, open Improve on the shared text, exactly as shared. Any other link does not.
 *
 * The real App with Pro decided by a real licence, its real navigator and the real Improve screen.
 * Device boundaries only: the native Scribe entry module, the OS link events, and the boundaries the
 * licensed app runs on (Keychain, SQLite, TCP, mDNS).
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

/** The phone's side of Share: the extension opening the app, and the OS opening other links. */
interface SharePhone {
  /** The Share extension opens `scheme://improve` with the text, encoded as the extension does. */
  share(text: string, scheme: string): void;
  openLink(url: string): void;
}

/** As ShareViewController encodes it: letters and digits stay, everything else is percent-encoded. */
const encodeAsExtension = (text: string): string =>
  encodeURIComponent(text).replace(/[!'()*._~-]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

let mesh: LicensedMesh;
let app: App | undefined;

async function launchOnIPhone(): Promise<{ app: App; phone: SharePhone }> {
  const { launchLicensedApp } = require('../../harness/proHarness');
  const handlers: LinkHandler[] = [];
  const launched: App = await launchLicensedApp({
    mesh,
    secrets: new Map(),
    configure: () => {
      const RN = require('react-native');
      Object.defineProperty(RN.Platform, 'OS', { value: 'ios', configurable: true });
      RN.NativeModules.ScribeEntryModule = {
        takePending: async () => null,
        finish: async () => false,
      };
      RN.Linking.addEventListener = (type: string, handler: LinkHandler) => {
        if (type === 'url') handlers.push(handler);
        return { remove: () => handlers.splice(handlers.indexOf(handler), 1) };
      };
    },
  });
  app = launched;
  const openLink = (url: string): void =>
    launched.rtl.act(() => {
      for (const handler of [...handlers]) handler({ url });
    });
  const phone: SharePhone = {
    share: (text, scheme) => openLink(`${scheme}://improve?text=${encodeAsExtension(text)}`),
    openLink,
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

  it.each(['ai.offgridmobile.dev', 'ai.offgridmobile', 'offgrid'])(
    '%s://improve opens Improve on the shared text',
    async scheme => {
      const { app: { view }, phone } = await launchOnIPhone();

      phone.share('What we do:\n- Build in sprints', scheme);

      expect(await view.findByTestId('improve-original')).toHaveTextContent('What we do:\n- Build in sprints');
    },
  );

  it('the text arrives exactly as shared: plus signs, ampersands and emoji included', async () => {
    const { app: { view }, phone } = await launchOnIPhone();

    phone.share('Q3: 2+2 & more — café 🌱', 'ai.offgridmobile');

    expect(await view.findByTestId('improve-original')).toHaveTextContent('Q3: 2+2 & more — café 🌱');
  });

  it('another link into the app, or an improve link with no text, does not open Improve', async () => {
    const { app: { view }, phone } = await launchOnIPhone();

    phone.openLink('offgrid://oauth/callback?code=1');
    phone.openLink('ai.offgridmobile://improve?text=%20%20');

    expect(view.queryByTestId('improve-original')).toBeNull();
    phone.share('What we do:', 'offgrid');
    expect(await view.findByTestId('improve-original')).toHaveTextContent('What we do:');
  });
});
