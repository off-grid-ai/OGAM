/** APP-P1-016 — real Pro activates and revokes live through the full App. */
import Icon from 'react-native-vector-icons/Feather';
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';

const PRO_LICENSE_SERVICE = 'off-grid-pro-license';
type Credential = { username: string; password: string };

function installStatefulKeychain(credentials: Map<string, Credential>): void {
  const Keychain = require('react-native-keychain') as {
    ACCESSIBLE?: Record<string, string>;
    getGenericPassword: jest.Mock;
    setGenericPassword: jest.Mock;
    resetGenericPassword: jest.Mock;
  };
  Keychain.ACCESSIBLE = {
    ...(Keychain.ACCESSIBLE ?? {}),
    AFTER_FIRST_UNLOCK: 'after-first-unlock',
  };
  Keychain.getGenericPassword.mockImplementation(
    async (options?: { service?: string }) =>
      credentials.get(options?.service ?? 'default') ?? false,
  );
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
  Keychain.resetGenericPassword.mockImplementation(
    async (options?: { service?: string }) => {
      credentials.delete(options?.service ?? 'default');
      return true;
    },
  );
}

function pressChatBack(app: Awaited<ReturnType<typeof renderMainApp>>): void {
  const back = app.view
    .UNSAFE_getAllByType(Icon)
    .find(icon => icon.props.name === 'arrow-left');
  if (!back) throw new Error('Chat back control not found');
  app.rtl.fireEvent.press(back.parent!);
}

async function openChat(
  app: Awaited<ReturnType<typeof renderMainApp>>,
): Promise<void> {
  if (app.view.queryByTestId('browse-models-button')) {
    await openChatWithJourneyModel(app.rtl, app.view);
    return;
  }
  app.rtl.fireEvent.press(app.view.getByTestId('new-chat-button'));
  await app.rtl.waitFor(() =>
    expect(app.view.getByTestId('chat-screen')).toBeTruthy(),
  );
}

function keygenResponse(code: 'VALID' | 'SUSPENDED'): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      meta: { valid: code === 'VALID', code },
      data: {
        id: 'license-1',
        attributes: { expiry: null, metadata: {}, name: 'Pro' },
      },
    }),
  } as Response;
}

describe('P1 full-App Pro entitlement lifecycle', () => {
  it('registers paid UI live and removes it live when the dev entitlement changes', async () => {
    const app = await renderMainApp({
      persistedAppState: { devProDisabled: true },
    });

    app.rtl.fireEvent.press(app.view.getByTestId('settings-tab'));
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByText('Turn on Pro (DEV)')),
    );
    await app.rtl.waitFor(() =>
      expect(app.view.getByText('Turn off Pro (DEV)')).toBeTruthy(),
    );

    app.rtl.fireEvent.press(app.view.getByTestId('home-tab'));
    await openChat(app);
    await app.rtl.waitFor(() =>
      expect(app.view.getByTestId('chat-mode-toggle')).toBeTruthy(),
    );

    pressChatBack(app);
    app.rtl.fireEvent.press(app.view.getByTestId('settings-tab'));
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByText('Turn off Pro (DEV)')),
    );
    await app.rtl.waitFor(() =>
      expect(app.view.getByText('Turn on Pro (DEV)')).toBeTruthy(),
    );

    app.rtl.fireEvent.press(app.view.getByTestId('home-tab'));
    await openChat(app);
    await app.rtl.waitFor(() =>
      expect(app.view.queryByTestId('chat-mode-toggle')).toBeNull(),
    );

    pressChatBack(app);
    app.rtl.fireEvent.press(app.view.getByTestId('settings-tab'));
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByText('Turn on Pro (DEV)')),
    );
    app.rtl.fireEvent.press(app.view.getByTestId('home-tab'));
    await openChat(app);
    await app.rtl.waitFor(() =>
      expect(app.view.getAllByTestId('chat-mode-toggle')).toHaveLength(1),
    );
  }, 60000);

  it('tears down gated behavior when Keygen revokes a cached license on foreground', async () => {
    const credentials = new Map<string, Credential>([
      [
        PRO_LICENSE_SERVICE,
        {
          username: 'license',
          password: JSON.stringify({
            isPro: true,
            key: 'key/active',
            licenseId: 'license-1',
            expiry: null,
            verifiedAt: Date.now(),
          }),
        },
      ],
    ]);
    let validationCode: 'VALID' | 'SUSPENDED' = 'VALID';
    global.fetch = jest.fn(async () => keygenResponse(validationCode));

    const app = await renderMainApp({
      persistedAppState: { devProDisabled: true },
      beforeRender: () => installStatefulKeychain(credentials),
    });
    await openChat(app);
    await app.rtl.waitFor(() =>
      expect(app.view.getByTestId('chat-mode-toggle')).toBeTruthy(),
    );

    validationCode = 'SUSPENDED';
    app.boundary.emitAppStateChange('background');
    app.boundary.emitAppStateChange('active');

    await app.rtl.waitFor(
      () => expect(app.view.queryByTestId('chat-mode-toggle')).toBeNull(),
      { timeout: 10000 },
    );
    expect(credentials.get(PRO_LICENSE_SERVICE)?.password).toContain(
      '"isPro":false',
    );
  }, 60000);
});
