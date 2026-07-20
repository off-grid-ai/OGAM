/** APP-P0-005 - cold start, resume, and navigation cannot bypass App Lock. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const AUTH_STORAGE_KEY = 'local-llm-auth-storage';
const AUTH_SERVICE = 'ai.offgridmobile.auth';
const PASSPHRASE = 'offline-2468';

type KeychainCredential = { username: string; password: string };

function installStatefulKeychain(
  credentials: Map<string, KeychainCredential>,
): void {
  const Keychain = require('react-native-keychain') as {
    ACCESSIBLE?: { WHEN_UNLOCKED: string };
    setGenericPassword: jest.Mock;
    getGenericPassword: jest.Mock;
    resetGenericPassword: jest.Mock;
  };
  Keychain.ACCESSIBLE = { WHEN_UNLOCKED: 'when-unlocked' };
  Keychain.setGenericPassword.mockImplementation(
    async (
      username: string,
      password: string,
      options?: { service?: string },
    ) => {
      credentials.set(options?.service ?? 'default', { username, password });
      return true;
    },
  );
  Keychain.getGenericPassword.mockImplementation(
    async (options?: { service?: string }) =>
      credentials.get(options?.service ?? 'default') ?? false,
  );
  Keychain.resetGenericPassword.mockImplementation(
    async (options?: { service?: string }) => {
      credentials.delete(options?.service ?? 'default');
      return true;
    },
  );
}

async function unlock(
  rtl: Awaited<ReturnType<typeof renderMainApp>>['rtl'],
  view: Awaited<ReturnType<typeof renderMainApp>>['view'],
): Promise<void> {
  rtl.fireEvent.changeText(
    view.getByPlaceholderText('Enter passphrase'),
    PASSPHRASE,
  );
  await rtl.waitFor(() => expect(view.getByText('Unlock')).toBeEnabled());
  rtl.fireEvent.press(view.getByText('Unlock'));
  await rtl.waitFor(() => expect(view.queryByTestId('app-locked')).toBeNull(), {
    timeout: 10000,
  });
}

describe('APP-P0-005 App Lock enforcement', () => {
  it('blocks routes on background resume and throughout persisted-auth cold start', async () => {
    const credentials = new Map<string, KeychainCredential>();
    const first = await renderMainApp({
      boundary: { llama: true },
      beforeRender: () => installStatefulKeychain(credentials),
    });

    // Enable the lock through the real Settings and passphrase setup screens.
    first.rtl.fireEvent.press(first.view.getByTestId('settings-tab'));
    first.rtl.fireEvent.press(
      await first.rtl.waitFor(() => first.view.getByText('Security')),
    );
    await first.rtl.waitFor(() =>
      expect(first.view.getByText('Passphrase Lock')).toBeTruthy(),
    );
    const ReactNative =
      require('react-native') as typeof import('react-native');
    first.rtl.fireEvent(
      first.view.UNSAFE_getByType(ReactNative.Switch),
      'valueChange',
      true,
    );
    await first.rtl.waitFor(() =>
      expect(first.view.getByText('Set Up Passphrase')).toBeTruthy(),
    );
    first.rtl.fireEvent.changeText(
      first.view.getByPlaceholderText('Enter passphrase (min 6 characters)'),
      PASSPHRASE,
    );
    first.rtl.fireEvent.changeText(
      first.view.getByPlaceholderText('Re-enter passphrase'),
      PASSPHRASE,
    );
    first.rtl.fireEvent.press(first.view.getByText('Enable Lock'));
    await first.rtl.waitFor(() => {
      expect(first.view.getByTestId('app-locked')).toBeTruthy();
      expect(first.view.getByText('App Locked')).toBeTruthy();
      expect(first.view.queryByTestId('home-screen')).toBeNull();
      expect(first.view.queryByText('Passphrase Lock')).toBeNull();
    });
    expect(credentials.has(AUTH_SERVICE)).toBe(true);

    await unlock(first.rtl, first.view);
    await first.rtl.waitFor(() =>
      expect(first.view.getByTestId('home-screen')).toBeTruthy(),
    );

    // APP-P1-018: locking hides the active transcript, and unlocking restores the
    // same mounted conversation instead of resetting or leaking it.
    await openChatWithJourneyModel(first.rtl, first.view);
    first.boundary.llama!.scriptCompletion({
      text: 'The private answer survives the lock.',
    });
    sendChatMessage(first.rtl, first.view, 'Keep this private conversation.');
    await first.rtl.waitFor(() =>
      expect(
        first.view.getByText('The private answer survives the lock.'),
      ).toBeTruthy(),
    );
    first.boundary.emitAppStateChange('background');
    first.boundary.emitAppStateChange('active');
    await first.rtl.waitFor(() => {
      expect(first.view.getByTestId('app-locked')).toBeTruthy();
      expect(
        first.view.queryByText('Keep this private conversation.'),
      ).toBeNull();
      expect(
        first.view.queryByText('The private answer survives the lock.'),
      ).toBeNull();
    });
    await unlock(first.rtl, first.view);
    await first.rtl.waitFor(() => {
      expect(first.view.getByTestId('home-screen')).toBeTruthy();
      expect(
        first.view.getByText('Keep this private conversation.'),
      ).toBeTruthy();
      expect(
        first.view.getByText('The private answer survives the lock.'),
      ).toBeTruthy();
    });
    first.rtl.fireEvent.press(first.view.getByTestId('conversation-item-0'));
    await first.rtl.waitFor(() =>
      expect(first.view.getByTestId('chat-screen')).toBeTruthy(),
    );
    const restoredChat = first.rtl.within(
      first.view.getByTestId('chat-screen'),
    );
    expect(
      restoredChat.getAllByText('Keep this private conversation.').length,
    ).toBeGreaterThan(0);
    expect(
      restoredChat.getAllByText('The private answer survives the lock.').length,
    ).toBeGreaterThan(0);
    first.rtl.fireEvent.press(first.view.getByTestId('chat-back-button'));

    // Lock while a nested route is open. Resume must still render only LockScreen.
    first.rtl.fireEvent.press(first.view.getByTestId('settings-tab'));
    first.rtl.fireEvent.press(
      await first.rtl.waitFor(() => first.view.getByText('Security')),
    );
    await first.rtl.waitFor(() =>
      expect(first.view.getByText('Passphrase Lock')).toBeTruthy(),
    );
    first.boundary.emitAppStateChange('background');
    first.boundary.emitAppStateChange('active');
    await first.rtl.waitFor(() => {
      expect(first.view.getByTestId('app-locked')).toBeTruthy();
      expect(first.view.queryByText('Passphrase Lock')).toBeNull();
      expect(first.view.queryByTestId('settings-tab')).toBeNull();
    });
    await unlock(first.rtl, first.view);
    first.view.unmount();

    // Cold launch with the persisted auth read held at the native storage boundary.
    // Navigation must never render while the lock decision is still unknown.
    jest.resetModules();
    const { installNativeBoundary, requireRTL } =
      require('../../harness/nativeBoundary') as typeof import('../../harness/nativeBoundary');
    installNativeBoundary({ fs: true });
    installStatefulKeychain(credentials);
    const asyncStorageModule = require('@react-native-async-storage/async-storage');
    const asyncStorage = (asyncStorageModule.default ?? asyncStorageModule) as {
      getItem: jest.Mock;
    };
    const committedRead = asyncStorage.getItem.getMockImplementation();
    expect(committedRead).toBeTruthy();
    const authSnapshot = await committedRead!(AUTH_STORAGE_KEY);
    expect(authSnapshot).toContain('"isEnabled":true');
    let releaseAuthRead!: () => void;
    const authReadBlocked = new Promise<void>(resolve => {
      releaseAuthRead = resolve;
    });
    asyncStorage.getItem.mockImplementation(async (key: string) => {
      if (key === AUTH_STORAGE_KEY) {
        await authReadBlocked;
        return authSnapshot;
      }
      return committedRead!(key);
    });

    jest.unmock('@react-navigation/native');
    const React = require('react');
    const coldRtl = requireRTL();
    const App = require('../../../App').default;
    const coldView = coldRtl.render(React.createElement(App));

    await coldRtl.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 300));
    });
    expect(coldView.getByTestId('app-loading')).toBeTruthy();
    expect(coldView.queryByTestId('home-screen')).toBeNull();
    expect(coldView.queryByTestId('settings-tab')).toBeNull();

    releaseAuthRead();
    await coldRtl.waitFor(
      () => {
        expect(coldView.queryByTestId('app-loading')).toBeNull();
        expect(coldView.getByTestId('app-locked')).toBeTruthy();
        expect(coldView.getByText('App Locked')).toBeTruthy();
        expect(coldView.queryByTestId('home-screen')).toBeNull();
      },
      { timeout: 10000 },
    );
    await unlock(coldRtl, coldView);
    await coldRtl.waitFor(() =>
      expect(coldView.getByTestId('model-download-screen')).toBeTruthy(),
    );

    coldView.unmount();
    asyncStorage.getItem.mockImplementation(committedRead!);
  }, 60000);
});
