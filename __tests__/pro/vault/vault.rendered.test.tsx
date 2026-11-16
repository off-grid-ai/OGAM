/**
 * The Vault on the phone, as the person uses it.
 *
 * SPEC: opening Vault asks the device for its key (Face ID, a fingerprint or the passcode). The
 * first time, that makes the key and an empty vault, sealed on disk: the file alone shows nothing.
 * New login saves an item and it is in the list; Lock closes the vault, and Unlock opens the same
 * items from the sealed file. Search finds an item by its title, username or website, and says so
 * when nothing matches. An item hides its password until Show; Copy puts a field on the clipboard
 * and clears it 30 seconds later. Edit changes a login; Delete asks first. Items from a paired device
 * show every kind with its own line: a card by its last digits, an identity, a one-time code, a
 * secure note. A cancelled prompt leaves the vault locked and says so. A vault whose key is gone
 * (the app was reinstalled) cannot be opened, and Start over makes a new one. A locked vault takes
 * no write. A save cut off half way (the old file gone, the new one not yet moved in) still opens.
 * An open item goes back to the list when the vault locks. Editing a login from a paired device
 * keeps its folder and favourite. With Vault sync on, the empty vault says items arrive from the
 * desktop and offers no Sync sharing button.
 *
 * The real Vault screens in a real navigator over the real phoneVault and @offgrid/sync's seal and
 * merge. Device boundaries only: the disk (memfs-backed react-native-fs), the Keychain (the
 * stateful deviceKeychain fake) and the native clipboard module.
 */
jest.unmock('@react-navigation/native');
jest.mock('react-native-keychain', () => require('../../harness/deviceKeychain').deviceKeychainModule());

import type React from 'react';
import { installNativeBoundary, requireRTL, type FsFake } from '../../harness/nativeBoundary';
import { refuseKeychainWrites, resetKeychainWrites } from '../../harness/deviceKeychain';
import { keychainState, resetKeychain, setKeychainUnreadable } from '../../harness/keyedRemoteServer';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type VaultModule = typeof import('../../../pro/vault/phoneVault');
type ListModule = typeof import('../../../pro/vault/ui/VaultScreen');
type ItemModule = typeof import('../../../pro/vault/ui/VaultItemScreen');
type SyncModule = typeof import('@offgrid/sync');

const describePro = proIsPresent() ? describe : describe.skip;

const KEY_SERVICE = 'off-grid-vault-key';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

interface Phone {
  fs: FsFake;
  vault: VaultModule['phoneVault'];
  PhoneVaultError: VaultModule['PhoneVaultError'];
  /** What the native clipboard module was asked to hold, in order. */
  clipboard: string[];
  /** The sealed vault file as it is on disk. */
  sealed: () => Promise<string>;
  /** Items arriving from a paired device, the way sync hands them over. */
  fromPeer: (items: import('@offgrid/sync').VaultSyncItem[]) => Promise<void>;
}

function installPhone(): Phone {
  resetKeychain();
  resetKeychainWrites();
  const { fs } = installNativeBoundary({ fs: true });
  const clipboard: string[] = [];
  require('react-native').NativeModules.SyncClipboardModule = {
    writeText: (text: string) => clipboard.push(text),
    setEnabled: () => undefined,
    addListener: () => undefined,
    removeListeners: () => undefined,
  };
  const { phoneVault, PhoneVaultError } = requirePro<VaultModule>('@offgrid/pro/vault/phoneVault')!;
  const sync = require('@offgrid/sync') as SyncModule;
  return {
    fs: fs!,
    vault: phoneVault,
    PhoneVaultError,
    clipboard,
    sealed: () => fs!.module.readFile(`${fs!.DocumentDirectoryPath}/vault/vault.sealed`, 'utf8'),
    fromPeer: items =>
      phoneVault.applyFromPeer(
        items.map(item => ({
          id: sync.newVaultSyncId(),
          modifiedAt: sync.vaultSyncTime(Date.now()),
          deleted: false as const,
          item,
        })),
      ),
  };
}

/** The Vault list, in a real stack navigator with its item route. */
function openVault() {
  const rtl = requireRTL();
  const ReactRuntime = require('react') as typeof React;
  const { NavigationContainer, createNavigationContainerRef } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { VaultScreen } = requirePro<ListModule>('@offgrid/pro/vault/ui/VaultScreen')!;
  const { VaultItemScreen } = requirePro<ItemModule>('@offgrid/pro/vault/ui/VaultItemScreen')!;
  const navigation = createNavigationContainerRef();
  const Stack = createNativeStackNavigator();
  const view = rtl.render(
    ReactRuntime.createElement(
      NavigationContainer,
      { ref: navigation },
      ReactRuntime.createElement(
        Stack.Navigator,
        { screenOptions: { headerShown: false } },
        ReactRuntime.createElement(Stack.Screen, { name: 'Vault', component: VaultScreen }),
        ReactRuntime.createElement(Stack.Screen, { name: 'VaultItem', component: VaultItemScreen }),
        ReactRuntime.createElement(Stack.Screen, { name: 'SyncSharingSettings', component: () => null }),
      ),
    ),
  );
  return { rtl, view, navigation: navigation as any };
}

type Rtl = ReturnType<typeof requireRTL>;

/** Fill the login form and save it. */
async function saveLogin(rtl: Rtl, view: any, fields: Record<string, string>) {
  for (const [field, value] of Object.entries(fields)) {
    rtl.fireEvent.changeText(view.getByTestId(`vault-edit-${field}`), value);
  }
  rtl.fireEvent.press(view.getByTestId('vault-item-save'));
  await rtl.waitFor(() => expect(view.queryByTestId('vault-item-save')).toBeNull());
}

/** Back to the list, as the header's Back does. */
function back(rtl: Rtl, navigation: any) {
  rtl.act(() => navigation.goBack());
}

/** The titles the list shows, in order. */
function listed(view: any): string[] {
  return view.queryAllByTestId(/^vault-item-\d+$/).map((row: any) => row.props.accessibilityLabel);
}

describePro('Vault on the phone', () => {
  afterEach(() => {
    jest.useRealTimers();
    resetKeychainWrites();
  });

  it('the first open makes an empty sealed vault; a new login is kept through a lock', async () => {
    const phone = installPhone();
    const { rtl, view, navigation } = openVault();

    await view.findByTestId('vault-empty-new');
    expect(view.getByTestId('vault-sync-settings')).toBeTruthy();
    expect(keychainState().items.has(KEY_SERVICE)).toBe(true);

    rtl.fireEvent.press(view.getByTestId('vault-empty-new'));
    await view.findByTestId('vault-edit-title');
    await saveLogin(rtl, view, {
      title: 'Mail',
      username: 'sam@example.com',
      password: 'hunter2',
      url: 'https://mail.example.com',
    });
    back(rtl, navigation);
    await rtl.waitFor(() => expect(listed(view)).toEqual(['Mail']));
    const sealed = await phone.sealed();
    expect(sealed).not.toMatch(/hunter2|sam@example\.com|Mail/);

    rtl.fireEvent.press(view.getByTestId('vault-lock'));
    await view.findByTestId('vault-unlock');
    expect(listed(view)).toEqual([]);
    rtl.fireEvent.press(view.getByTestId('vault-unlock'));
    await rtl.waitFor(() => expect(listed(view)).toEqual(['Mail']));
  });

  it('a login without a title is named from its website', async () => {
    installPhone();
    const { rtl, view, navigation } = openVault();
    rtl.fireEvent.press(await view.findByTestId('vault-empty-new'));
    await view.findByTestId('vault-edit-title');
    await saveLogin(rtl, view, { username: 'sam', password: 'pw', url: 'https://bank.example.com' });
    back(rtl, navigation);
    await rtl.waitFor(() => expect(listed(view)).toEqual(['bank.example.com']));
  });

  it('search finds an item by title, username or website, and says when nothing matches', async () => {
    const phone = installPhone();
    const { rtl, view } = openVault();
    await view.findByTestId('vault-empty-new');
    for (const [title, username, url] of [
      ['Mail', 'sam@example.com', 'https://mail.example.com'],
      ['Bank', 'sam-banking', 'https://bank.example.org'],
    ]) {
      await rtl.act(() => phone.vault.save({ kind: 'login', title, username, password: 'pw', urls: [url!] }));
    }
    await rtl.waitFor(() => expect(listed(view)).toEqual(['Bank', 'Mail']));

    const search = view.getByTestId('vault-search');
    for (const [query, found] of [
      ['mail', ['Mail']],
      ['banking', ['Bank']],
      ['example.org', ['Bank']],
    ] as const) {
      rtl.fireEvent.changeText(search, query);
      expect(listed(view)).toEqual(found);
    }
    rtl.fireEvent.changeText(search, 'nothing');
    expect(listed(view)).toEqual([]);
    expect(view.getByText(/Nothing matches/)).toBeTruthy();
  });

  it('an item hides its password until Show; Copy clears the clipboard after 30 seconds', async () => {
    const phone = installPhone();
    const { rtl, view } = openVault();
    await view.findByTestId('vault-empty-new');
    await rtl.act(() =>
      phone.vault.save({
        kind: 'login',
        title: 'Mail',
        username: 'sam@example.com',
        password: 'hunter2',
        urls: ['https://mail.example.com'],
        totpSecret: TOTP_SECRET,
        notes: 'Recovery codes in the safe.',
      }),
    );
    rtl.fireEvent.press(await view.findByTestId('vault-item-0'));
    await view.findByLabelText('Show password');
    expect(view.queryByText('hunter2')).toBeNull();
    expect(view.getByText('Recovery codes in the safe.')).toBeTruthy();
    expect(view.getByText(/^One-time code/)).toBeTruthy();

    rtl.fireEvent.press(view.getByLabelText('Show password'));
    expect(view.getByText('hunter2')).toBeTruthy();
    rtl.fireEvent.press(view.getByLabelText('Hide password'));
    expect(view.queryByText('hunter2')).toBeNull();

    jest.useFakeTimers();
    rtl.fireEvent.press(view.getByLabelText('Copy password'));
    expect(phone.clipboard).toEqual(['hunter2']);
    expect(view.getByText('Password copied. Clears in 30 seconds.')).toBeTruthy();
    rtl.fireEvent.press(view.getByLabelText('Copy username'));
    rtl.act(() => {
      jest.advanceTimersByTime(29_000);
    });
    expect(phone.clipboard).toEqual(['hunter2', 'sam@example.com']);
    rtl.act(() => {
      jest.advanceTimersByTime(1_000);
    });
    // One clear, 30 seconds after the last copy.
    expect(phone.clipboard).toEqual(['hunter2', 'sam@example.com', '']);
    rtl.fireEvent.press(view.getByLabelText('Copy one-time code'));
    expect(phone.clipboard.at(-1)).toMatch(/^\d{6}$/);
  });

  it('Edit changes a login; Delete asks first, then the item is gone', async () => {
    const phone = installPhone();
    const { rtl, view, navigation } = openVault();
    await view.findByTestId('vault-empty-new');
    await rtl.act(() =>
      phone.vault.save({ kind: 'login', title: 'Mail', username: 'sam', password: 'old', urls: ['https://a.example', 'https://b.example'] }),
    );
    rtl.fireEvent.press(await view.findByTestId('vault-item-0'));
    rtl.fireEvent.press(await view.findByTestId('vault-item-edit'));
    await saveLogin(rtl, view, { password: 'new', notes: 'Changed on the phone.' });
    const [entry] = phone.vault.entries();
    expect(entry!.item).toMatchObject({
      kind: 'login',
      password: 'new',
      notes: 'Changed on the phone.',
      urls: ['https://a.example', 'https://b.example'],
    });

    rtl.fireEvent.press(view.getByTestId('vault-item-delete'));
    const alert = await view.findByTestId('app-alert');
    rtl.fireEvent.press(rtl.within(alert).getByLabelText('Cancel'));
    expect(phone.vault.entries()).toHaveLength(1);

    rtl.fireEvent.press(view.getByTestId('vault-item-delete'));
    rtl.fireEvent.press(rtl.within(await view.findByTestId('app-alert')).getByLabelText('Delete'));
    await rtl.waitFor(() => expect(navigation.getCurrentRoute().name).toBe('Vault'));
    await view.findByTestId('vault-empty-new');
    expect(phone.vault.entries()).toEqual([]);
    // The deletion is kept, as a tombstone, for paired devices.
    expect(phone.vault.stamps()).toEqual([expect.objectContaining({ id: entry!.id, deleted: true })]);
  });

  it('items from a paired device show every kind with its own line', async () => {
    const phone = installPhone();
    const { rtl, view } = openVault();
    await view.findByTestId('vault-empty-new');
    await rtl.act(() =>
      phone.fromPeer([
        { kind: 'card', title: 'Visa', cardholder: 'Sam Lee', number: '4111111111111111', expMonth: 3, expYear: 2030, cvv: '123' },
        { kind: 'card', title: 'Store card', cardholder: 'Sam Lee', number: '', expMonth: 1, expYear: 2029, cvv: '' },
        {
          kind: 'identity', title: 'Home', fullName: 'Sam Lee', email: 'sam@example.com', phone: '555', address1: '1 Main St',
          address2: '', city: 'Springfield', region: '', postalCode: '12345', country: 'US', company: 'Acme',
        },
        { kind: 'authenticator', title: 'GitHub', issuer: 'GitHub', account: 'sam', totpSecret: TOTP_SECRET, urls: ['https://github.com'], favorite: true },
        { kind: 'note', title: 'Wifi', body: 'The password is on the router.' },
      ]),
    );
    await rtl.waitFor(() => expect(listed(view)).toEqual(['GitHub', 'Home', 'Store card', 'Visa', 'Wifi']));
    expect(view.getByText('•••• 1111')).toBeTruthy();
    expect(view.getByText('Sam Lee')).toBeTruthy();
    expect(view.getByText('sam@example.com')).toBeTruthy();
    expect(view.getByText('GitHub · sam')).toBeTruthy();
    expect(view.getByText('Secure note')).toBeTruthy();

    const open = async (title: string) => {
      rtl.fireEvent.press(view.getByLabelText(title));
      await view.findByTestId('vault-item-delete');
    };
    await open('Visa');
    expect(view.getByText('03/2030')).toBeTruthy();
    expect(view.getByLabelText('Show number')).toBeTruthy();
    expect(view.getByLabelText('Show security code')).toBeTruthy();
    // Only a login is edited on the phone.
    expect(view.queryByTestId('vault-item-edit')).toBeNull();
  });

  it('every kind opens with its fields', async () => {
    const phone = installPhone();
    const { rtl, view, navigation } = openVault();
    await view.findByTestId('vault-empty-new');
    await rtl.act(() =>
      phone.fromPeer([
        {
          kind: 'identity', title: 'Home', fullName: 'Sam Lee', email: 'sam@example.com', phone: '555', address1: '1 Main St',
          address2: '', city: 'Springfield', region: '', postalCode: '12345', country: 'US', company: 'Acme',
        },
        { kind: 'authenticator', title: 'GitHub', issuer: 'GitHub Inc', account: 'sam', totpSecret: TOTP_SECRET, urls: [] },
        { kind: 'note', title: 'Wifi', body: 'The password is on the router.' },
      ]),
    );
    const open = async (title: string) => {
      rtl.fireEvent.press(await view.findByLabelText(title));
      await view.findByTestId('vault-item-delete');
    };

    await open('Home');
    expect(view.getByText('1 Main St\nSpringfield\n12345\nUS')).toBeTruthy();
    expect(view.getByText('Acme')).toBeTruthy();
    back(rtl, navigation);

    await open('GitHub');
    expect(view.getByText(/^One-time code · \d+s$/)).toBeTruthy();
    expect(view.getByText('GitHub Inc')).toBeTruthy();
    back(rtl, navigation);

    await open('Wifi');
    expect(view.queryByText('The password is on the router.')).toBeNull();
    rtl.fireEvent.press(view.getByLabelText('Show note'));
    expect(view.getByText('The password is on the router.')).toBeTruthy();
  });

  it('a cancelled prompt leaves the vault locked and says so; Unlock tries again', async () => {
    const phone = installPhone();
    await phone.vault.unlock();
    phone.vault.lock();
    setKeychainUnreadable(true);

    const { rtl, view } = openVault();
    expect((await view.findByRole('alert')).props.children).toBe('Vault stayed locked. Try again.');
    expect(phone.vault.status()).toBe('locked');

    setKeychainUnreadable(false);
    rtl.fireEvent.press(view.getByTestId('vault-unlock'));
    await view.findByTestId('vault-empty-new');
  });

  it('a phone that refuses to keep the key leaves the vault locked', async () => {
    const phone = installPhone();
    refuseKeychainWrites('Set a passcode first.');
    const { view } = openVault();
    expect((await view.findByRole('alert')).props.children).toBe('Vault stayed locked. Try again.');
    expect(phone.vault.status()).toBe('locked');
  });

  it('a vault whose key is gone cannot be opened; Start over makes a new one', async () => {
    const phone = installPhone();
    await phone.vault.unlock();
    await phone.vault.save({ kind: 'note', title: 'Old', body: 'x' });
    phone.vault.lock();
    // The app was reinstalled: the sealed file is still here, its key is not.
    resetKeychain();

    const { rtl, view } = openVault();
    rtl.fireEvent.press(await view.findByTestId('vault-start-over'));
    rtl.fireEvent.press(await view.findByTestId('vault-unlock'));
    await view.findByTestId('vault-empty-new');
    expect(phone.vault.entries()).toEqual([]);
  });

  it('a locked vault takes no write, and deleting what is not there changes nothing', async () => {
    const phone = installPhone();
    await expect(phone.vault.save({ kind: 'note', title: 'Locked', body: 'x' })).rejects.toBeInstanceOf(
      phone.PhoneVaultError,
    );
    await phone.vault.unlock();
    const changes: string[] = [];
    phone.vault.onChanged(() => changes.push('changed'));
    await phone.vault.remove('missing');
    expect(changes).toEqual([]);
    const id = await phone.vault.save({ kind: 'note', title: 'One', body: 'x' });
    // Two edits inside one second: the later one still wins.
    await phone.vault.save({ kind: 'note', title: 'Two', body: 'y' }, id);
    expect(phone.vault.entry(id)?.item.title).toBe('Two');
    expect(phone.vault.recordsFor([id])).toHaveLength(1);
  });

  it('a save cut off half way still opens', async () => {
    const phone = installPhone();
    await phone.vault.unlock();
    await phone.vault.save({ kind: 'note', title: 'Kept', body: 'x' });
    phone.vault.lock();
    // The phone stopped after removing the old file and before moving the new one in.
    const dir = `${phone.fs.DocumentDirectoryPath}/vault`;
    await phone.fs.module.moveFile(`${dir}/vault.sealed`, `${dir}/vault.sealed.tmp`);

    await phone.vault.unlock();
    expect(phone.vault.entries().map(e => e.item.title)).toEqual(['Kept']);
  });

  it('an open item goes back to the list when the vault locks', async () => {
    const phone = installPhone();
    const { rtl, view, navigation } = openVault();
    await view.findByTestId('vault-empty-new');
    await rtl.act(() =>
      phone.vault.save({ kind: 'login', title: 'Mail', username: '', password: 'pw', urls: ['https://mail.example'] }),
    );
    // No username: the line under the title is the website.
    expect(await view.findByText('https://mail.example')).toBeTruthy();
    rtl.fireEvent.press(view.getByTestId('vault-item-0'));
    await view.findByTestId('vault-item-delete');

    rtl.act(() => phone.vault.lock());
    await rtl.waitFor(() => expect(navigation.getCurrentRoute().name).toBe('Vault'));
    await view.findByTestId('vault-unlock');
  });

  it('editing a login from a paired device keeps its folder and favourite', async () => {
    const phone = installPhone();
    const { rtl, view } = openVault();
    await view.findByTestId('vault-empty-new');
    await rtl.act(() =>
      phone.fromPeer([
        { kind: 'login', title: 'Bank', folder: 'Money', favorite: true, urls: [], username: 'sam', password: 'old', notes: 'PIN at home.' },
        { kind: 'identity', title: 'Work', fullName: 'Sam Lee', email: '', phone: '', address1: '', address2: '', city: '', region: '', postalCode: '', country: '' },
      ]),
    );
    // No email: an identity is listed by its name.
    expect(await view.findByText('Sam Lee')).toBeTruthy();
    rtl.fireEvent.press(view.getByLabelText('Bank'));
    rtl.fireEvent.press(await view.findByTestId('vault-item-edit'));
    await saveLogin(rtl, view, { password: 'new' });

    const bank = phone.vault.entries().find(e => e.item.title === 'Bank')!;
    expect(bank.item).toMatchObject({ folder: 'Money', favorite: true, password: 'new', notes: 'PIN at home.' });
  });

  it('with Vault sync on, the empty vault says items arrive from the desktop', async () => {
    installPhone();
    const { stateSyncService } = require('../../../pro/sync/stateSyncService');
    await stateSyncService.setCategoryEnabled('vault', true);
    const { view } = openVault();
    await view.findByTestId('vault-empty-new');
    expect(view.getByText(/arrive while its vault is unlocked/)).toBeTruthy();
    expect(view.queryByTestId('vault-sync-settings')).toBeNull();
  });
});
