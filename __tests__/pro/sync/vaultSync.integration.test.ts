/**
 * The Vault between the phone and a paired Mac.
 *
 * SPEC: Vault sync is off until I turn it on in Sync sharing. With it off, nothing moves either way.
 * Turned on while the phone's vault is open, the two vaults exchange at once: the Mac's logins
 * arrive here and the phone's go to the Mac. A login I add or delete on the phone reaches the Mac a
 * moment later, a deletion as a deletion, and one deleted on the Mac goes from the phone. Turned off
 * again, nothing more moves. A locked phone takes nothing; when I unlock it, it asks
 * for and gets whatever it missed.
 *
 * The real App with Pro decided by a real licence, paired with a Mac on the LAN by the code the Sync
 * screen shows. The Mac is the shared sync engine over the in-memory TCP boundary, running
 * @offgrid/sync's VaultSyncCoordinator over its own vault, exactly as Off Grid AI Desktop does. The
 * phone runs its real phoneVault and vaultSyncService. Device boundaries only: the disk
 * (memfs-backed react-native-fs), AsyncStorage, the Keychain, SQLite and the native TCP / mDNS
 * modules.
 */
// Loaded first for the device boundary's shared test budget: a pairing journey outlasts jest's default.
import '../../harness/nativeBoundary';
import type { LicensedMesh } from '../../harness/licensedMesh';
import type { PairedPeer } from '../../harness/proHarness';
import { proIsPresent, requirePro } from '../helpers/requirePro';

jest.unmock('@react-navigation/native');

jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

jest.mock('@op-engineering/op-sqlite', () =>
  require('../../harness/sqliteFake').realSqliteModule({ only: ['offgrid-sync.sqlite'] }),
);

type App = Awaited<ReturnType<typeof import('../../harness/proHarness').launchLicensedApp>>;
type SyncModule = typeof import('@offgrid/sync');
type VaultModule = typeof import('../../../pro/vault/phoneVault');
type VaultRecord = import('@offgrid/sync').VaultSyncRecord;
type VaultItem = import('@offgrid/sync').VaultSyncItem;

const describePro = proIsPresent() ? describe : describe.skip;

const MAC = { id: 'mac-vault', name: 'Studio Mac' };

async function waitFor(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/** Nothing more is on the way: a few round trips of the in-memory network. */
const settle = () => new Promise(resolve => setTimeout(resolve, 300));

/** The Mac's vault: its records, open, and the shared coordinator a Desktop runs over them. */
interface MacVault {
  records: Map<string, VaultRecord>;
  titles(): string[];
  add(item: VaultItem): string;
  /** Delete an item on the Mac: a tombstone newer than what it replaces. */
  remove(id: string): void;
  announce(): Promise<number>;
}

let mesh: LicensedMesh;
let app: App | undefined;
let mac: PairedPeer | undefined;

const login = (title: string): VaultItem => ({
  kind: 'login',
  title,
  urls: [`https://${title.toLowerCase()}.example`],
  username: 'sam',
  password: `${title}-secret`,
});

async function installPhone() {
  const { launchLicensedApp, startPairedPeer } = require('../../harness/proHarness');
  app = await launchLicensedApp({ mesh, secrets: new Map() });
  const { view, rtl } = app!;
  const sync = require('@offgrid/sync') as SyncModule;

  const records = new Map<string, VaultRecord>();
  let coordinator: InstanceType<SyncModule['VaultSyncCoordinator']>;
  mac = (await startPairedPeer({
    mesh,
    device: MAC,
    onAppMessage: (_peer: PairedPeer, deviceId: string, channel: string, data: unknown) => {
      if (channel === sync.VAULT_CHANNEL) coordinator.onMessage(deviceId, data).catch(() => undefined);
    },
  })) as PairedPeer;
  const peer = mac;
  coordinator = new sync.VaultSyncCoordinator(
    {
      active: () => true,
      stamps: async () => [...records.values()].map(sync.vaultSyncStamp),
      records: async ids => ids.flatMap(id => (records.has(id) ? [records.get(id)!] : [])),
      apply: async incoming => {
        for (const record of sync.mergeVaultSyncRecords([...records.values()], incoming)) {
          records.set(record.id, record);
        }
      },
    },
    {
      connectedDeviceIds: () => [...peer.connected],
      accepts: () => true,
      send: (deviceId, message) => peer.engine.sendApp(deviceId, sync.VAULT_CHANNEL, message),
    },
  );
  const vault: MacVault = {
    records,
    titles: () =>
      [...records.values()].flatMap(r => (r.deleted ? [] : [r.item.title])).sort(),
    add: item => {
      const id = sync.newVaultSyncId();
      records.set(id, { id, modifiedAt: sync.vaultSyncTime(Date.now()), deleted: false, item });
      return id;
    },
    remove: id => {
      const previous = records.get(id)!;
      records.set(id, { id, modifiedAt: previous.modifiedAt + 1000, deleted: true });
    },
    announce: () => coordinator.announce(),
  };

  rtl.fireEvent.press(view.getByTestId('settings-tab'));
  rtl.fireEvent.press(await view.findByTestId('open-sync-settings'));
  await peer.pairWithPhone(view);

  const { phoneVault } = requirePro<VaultModule>('@offgrid/pro/vault/phoneVault')!;
  const phoneTitles = () => phoneVault.entries().map(e => e.item.title);

  /** Sync sharing's Vault switch, as the person flips it. */
  const setVaultSync = async (on: boolean) => {
    if (!view.queryByTestId('sync-vault-toggle')) {
      rtl.fireEvent.press(await view.findByTestId('sync-open-sharing'));
    }
    const toggle = await view.findByTestId('sync-vault-toggle');
    await rtl.act(async () => {
      rtl.fireEvent(toggle, 'valueChange', on);
    });
    const { stateSyncService } = require('../../../pro/sync/stateSyncService');
    await waitFor(() => stateSyncService.preferences().vault === on, `Vault sync ${on ? 'on' : 'off'}`);
  };

  return { rtl, view, mac: vault, phoneVault, phoneTitles, setVaultSync };
}

describePro('Vault sync with a paired Mac', () => {
  beforeEach(() => {
    const { createLicensedMesh } = require('../../harness/licensedMesh');
    mesh = createLicensedMesh();
    mesh.reset();
  });

  afterEach(async () => {
    await mac?.stop();
    mac = undefined;
    await app?.close();
    app = undefined;
    mesh.restore();
  });

  it('is off until turned on; turning it on with the vault open exchanges both ways', async () => {
    const phone = await installPhone();
    phone.mac.add(login('Mail'));
    await phone.rtl.act(() => phone.phoneVault.unlock());
    await phone.rtl.act(() => phone.phoneVault.save(login('Bank')).then(() => undefined));

    await phone.mac.announce();
    await settle();
    expect(phone.phoneTitles()).toEqual(['Bank']);
    expect(phone.mac.titles()).toEqual(['Mail']);

    await phone.setVaultSync(true);
    await waitFor(() => phone.phoneTitles().join() === 'Bank,Mail', 'the Mac login on the phone');
    await waitFor(() => phone.mac.titles().join() === 'Bank,Mail', 'the phone login on the Mac');
    const bank = [...phone.mac.records.values()].find(r => !r.deleted && r.item.title === 'Bank');
    expect(bank && !bank.deleted && bank.item).toMatchObject({ password: 'Bank-secret' });
  });

  it('a login added or deleted on the phone reaches the Mac', async () => {
    const phone = await installPhone();
    await phone.setVaultSync(true);
    await phone.rtl.act(() => phone.phoneVault.unlock());

    let id = '';
    await phone.rtl.act(async () => {
      id = await phone.phoneVault.save(login('Shop'));
    });
    await waitFor(() => phone.mac.titles().join() === 'Shop', 'the new login on the Mac');

    await phone.rtl.act(() => phone.phoneVault.remove(id));
    await waitFor(() => phone.mac.records.get(id)?.deleted === true, 'the deletion on the Mac');
    expect(phone.mac.titles()).toEqual([]);
  });

  it('a locked phone takes nothing, and gets what it missed when it unlocks', async () => {
    const phone = await installPhone();
    await phone.setVaultSync(true);
    phone.mac.add(login('Mail'));

    await phone.mac.announce();
    await settle();
    expect(phone.phoneVault.status()).toBe('locked');

    await phone.rtl.act(() => phone.phoneVault.unlock());
    await waitFor(() => phone.phoneTitles().join() === 'Mail', 'the missed login after unlock');
  });

  it('a login deleted on the Mac goes from the phone', async () => {
    const phone = await installPhone();
    await phone.setVaultSync(true);
    const id = phone.mac.add(login('Mail'));
    await phone.rtl.act(() => phone.phoneVault.unlock());
    await waitFor(() => phone.phoneTitles().join() === 'Mail', 'the Mac login on the phone');

    phone.mac.remove(id);
    await phone.mac.announce();
    await waitFor(() => phone.phoneTitles().length === 0, 'the deletion on the phone');
  });

  it('turned off again, nothing more moves', async () => {
    const phone = await installPhone();
    await phone.setVaultSync(true);
    await phone.rtl.act(() => phone.phoneVault.unlock());
    await phone.setVaultSync(false);

    phone.mac.add(login('Mail'));
    await phone.mac.announce();
    await phone.rtl.act(() => phone.phoneVault.save(login('Bank')).then(() => undefined));
    // Past the phone's one-second announce delay, and the round trips after it.
    await new Promise(resolve => setTimeout(resolve, 1200));
    await settle();
    expect(phone.phoneTitles()).toEqual(['Bank']);
    expect(phone.mac.titles()).toEqual(['Mail']);
  });
});
