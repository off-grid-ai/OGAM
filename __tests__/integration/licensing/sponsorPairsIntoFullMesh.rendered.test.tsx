/**
 * The phone that sponsors a new device into a FULL licence stays licensed itself.
 *
 * App 02ef21ea9 / pro c84468a9: pairing a new device when every seat is taken frees the seat of the
 * device away longest. The sponsoring phone registered first, so by age it WAS the device away
 * longest - and it evicted itself. The new device came on, and on the next launch this phone found
 * its own installation gone and dropped out of Pro.
 *
 * SPEC (OGAM user's view): I add a device from my phone when every seat is used. The device I have
 * not used for longest makes room. My phone is still Pro, today and after I reopen the app, and the
 * new device is in my list.
 *
 * The real App on the real navigation stack. Pro is NOT forced on: the developer unlock is off and
 * App boot decides Pro from the Keychain credential and the licence provider, which is the Keygen fake
 * at the HTTP boundary (it really holds machines and enforces the seat cap). The new device is a real
 * shared sync engine over the in-memory TCP boundary; it presents the code this phone shows.
 */
import type { LicensedMesh } from '../../harness/licensedMesh';

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

const SEATS = 3;
// Oldest first. This phone registers before both, so by age alone it would be the one to go.
const OLD_LAPTOP = { id: 'fp-old-laptop', name: 'Old laptop', platform: 'macos' };
const WORK_MAC = { id: 'fp-work-mac', name: 'Work Mac', platform: 'macos' };
const NEW_IPAD = { id: 'new-ipad', name: 'New iPad', platform: 'ios' };

async function openProScreen(app: App) {
  const { view, rtl } = app;
  rtl.fireEvent.press(view.getByTestId('settings-tab'));
  rtl.fireEvent.press(await view.findByText('Off Grid AI PRO'));
  await view.findByText('Off Grid AI Pro');
}

async function openDevicesFromSettings(app: App) {
  const { view, rtl } = app;
  rtl.fireEvent.press(view.getByTestId('settings-tab'));
  rtl.fireEvent.press(await view.findByTestId('open-sync-settings'));
  await view.findByTestId('sync-pairing-code-value');
}

describe('sponsoring a new device into a full licence', () => {
  let mesh: LicensedMesh;
  let app: App | undefined;
  let peer: Awaited<ReturnType<typeof import('../../harness/proHarness').startPairedPeer>> | undefined;
  const keychain = new Map<string, string>();

  beforeEach(() => {
    const { createLicensedMesh } = require('../../harness/licensedMesh');
    mesh = createLicensedMesh();
    mesh.reset(SEATS);
  });

  afterEach(async () => {
    await peer?.stop();
    peer = undefined;
    await app?.close();
    app = undefined;
    mesh.restore();
  });

  it('keeps this phone Pro after a relaunch, lists the new device and releases the seat away longest', async () => {
    const { launchLicensedApp, startPairedPeer } = require('../../harness/proHarness');
    let phone: App;
    app = phone = await launchLicensedApp({
      mesh,
      secrets: keychain,
      savedInstallations: [OLD_LAPTOP, WORK_MAC],
    });

    // BEFORE: Pro, from the licence alone.
    await openProScreen(phone);
    expect(await phone.view.findByText('Pro Active')).toBeTruthy();
    expect(phone.view.queryByLabelText('I have a license key')).toBeNull();
    phone.rtl.fireEvent.press(phone.view.getByLabelText('Back'));

    // BEFORE: every seat used, and the screen says which device pairing will remove.
    await openDevicesFromSettings(phone);
    expect(await phone.view.findByText(`${SEATS} of ${SEATS} devices saved`)).toBeTruthy();
    expect(phone.view.getByText('Old laptop')).toBeTruthy();
    expect(phone.view.getByText('Work Mac')).toBeTruthy();
    expect(
      await phone.view.findByText(
        'All slots are in use. Pairing another device will remove Old laptop, the one away longest.',
      ),
    ).toBeTruthy();
    expect(phone.view.queryByText('New iPad')).toBeNull();

    // A new device, never licensed, pairs by the code this phone shows.
    peer = await startPairedPeer({ mesh, device: NEW_IPAD, entitlement: 'joiner' });
    await peer!.pairWithPhone(phone.view);

    // The new device is in, the one away longest made room, and the count did not exceed the licence.
    await phone.rtl.waitFor(() => expect(phone.view.queryByText('Old laptop')).toBeNull(), { timeout: 8000 });
    expect(phone.view.getByText('New iPad')).toBeTruthy();
    expect(phone.view.getByText('Work Mac')).toBeTruthy();
    expect(phone.view.getByText(`${SEATS} of ${SEATS} devices saved`)).toBeTruthy();
    // And still Pro right now.
    phone.rtl.fireEvent.press(phone.view.getByLabelText('Back'));
    await openProScreen(phone);
    expect(await phone.view.findByText('Pro Active')).toBeTruthy();

    // RELAUNCH: the app is killed and opened again over the same disk, Keychain and licence.
    await peer!.stop();
    peer = undefined;
    await phone.close();
    app = undefined;
    app = phone = await launchLicensedApp({ mesh, secrets: keychain, relaunch: true });

    // Still Pro on the Pro screen - decided again from the licence on this launch.
    await openProScreen(phone);
    expect(await phone.view.findByText('Pro Active')).toBeTruthy();
    expect(phone.view.queryByLabelText('I have a license key')).toBeNull();
    phone.rtl.fireEvent.press(phone.view.getByLabelText('Back'));

    // Still Pro on the Devices screen: the new device is listed, the released seat stays released.
    await openDevicesFromSettings(phone);
    expect(await phone.view.findByText('New iPad', {}, { timeout: 8000 })).toBeTruthy();
    expect(phone.view.getByText('Work Mac')).toBeTruthy();
    expect(phone.view.queryByText('Old laptop')).toBeNull();
    expect(phone.view.getByText(`${SEATS} of ${SEATS} devices saved`)).toBeTruthy();
  }, 60_000);
});
