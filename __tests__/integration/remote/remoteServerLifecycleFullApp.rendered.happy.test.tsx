/** APP-P1-014/015 — full-App remote-server CRUD, switching, and actionable auth recovery. */
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED: 'when-unlocked' },
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

import { renderMainApp } from '../../harness/appJourney';
import { openTextModelPickerThroughHome } from '../../harness/fullAppRemoteJourney';

const SECRET = 'sk-super-secret-credential';
const FIRST_NAME = 'Research Server';
const EDITED_NAME = 'Research Server Renamed';
const SECOND_NAME = 'Backup Server';
const FIRST_ENDPOINT = 'http://192.168.1.20:1234';
const SECOND_ENDPOINT = 'http://192.168.1.21:5678';

const originalFetch = globalThis.fetch;

type KeychainCredential = { username: string; password: string };

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installRemoteBoundary(auth: { accepted: boolean }): void {
  globalThis.fetch = async input => {
    const url = String(input);
    if (!auth.accepted) {
      return new Response('Unauthorized', { status: 401 });
    }
    if (url.endsWith('/v1/models')) {
      const model = url.includes(':5678') ? 'beta-model' : 'alpha-model';
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: model, object: 'model', owned_by: 'test' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    return new Response('{}', {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function installStatefulKeychainBoundary(): void {
  const credentials = new Map<string, KeychainCredential>();
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

async function openRemoteServers(
  app: Awaited<ReturnType<typeof renderMainApp>>,
): Promise<void> {
  app.rtl.fireEvent.press(app.view.getByTestId('settings-tab'));
  app.rtl.fireEvent.press(
    await app.rtl.waitFor(() => app.view.getByText('Remote Servers')),
  );
  await app.rtl.waitFor(() =>
    expect(app.view.getByText('No Remote Servers')).toBeTruthy(),
  );
}

async function fillAndTestServer(
  app: Awaited<ReturnType<typeof renderMainApp>>,
  name: string,
  endpoint: string,
  apiKey?: string,
): Promise<void> {
  app.rtl.fireEvent.changeText(
    app.view.getByPlaceholderText('e.g., Off Grid AI Desktop'),
    name,
  );
  app.rtl.fireEvent.changeText(
    app.view.getByPlaceholderText('http://192.168.1.50:7878'),
    endpoint,
  );
  if (apiKey) {
    app.rtl.fireEvent.changeText(
      app.view.getByPlaceholderText('sk-...'),
      apiKey,
    );
  }
  app.rtl.fireEvent.press(app.view.getByText('Test Connection'));
}

async function pressRemoteModelNamed(
  app: Awaited<ReturnType<typeof renderMainApp>>,
  modelName: string,
): Promise<void> {
  let node = app.view.getByText(modelName);
  while (node.parent && node.props.testID !== 'remote-model-item') {
    node = node.parent;
  }
  expect(node.props.testID).toBe('remote-model-item');
  await app.rtl.act(async () => {
    app.rtl.fireEvent.press(node);
  });
}

function pressAccessibleText(
  app: Awaited<ReturnType<typeof renderMainApp>>,
  label: string,
): void {
  let node = app.view.getByText(label);
  while (node.parent && node.props.accessible !== true) {
    node = node.parent;
  }
  expect(node.props.accessible).toBe(true);
  app.rtl.fireEvent.press(node);
}

describe('full-App remote server lifecycle and authentication', () => {
  it('recovers from auth failure, keeps the credential out of persistence/logs, and clears a deleted active server', async () => {
    const auth = { accepted: false };
    installRemoteBoundary(auth);
    installStatefulKeychainBoundary();
    const app = await renderMainApp();
    await openRemoteServers(app);

    app.rtl.fireEvent.press(app.view.getByText('Add Server'));
    await fillAndTestServer(app, FIRST_NAME, FIRST_ENDPOINT, SECRET);
    await app.rtl.waitFor(() =>
      expect(app.view.getByText(/Server returned 401/)).toBeTruthy(),
    );
    expect(
      app.view.getByText(new RegExp(`Tried: ${FIRST_ENDPOINT}`)),
    ).toBeTruthy();
    const apiKeyInput = app.view.getByPlaceholderText('sk-...');
    expect(apiKeyInput.props.secureTextEntry).toBe(true);
    expect(app.view.queryByText(SECRET)).toBeNull();

    auth.accepted = true;
    app.rtl.fireEvent.press(app.view.getByText('Test Connection'));
    await app.rtl.waitFor(() =>
      expect(app.view.getByText(/Connected \(/)).toBeTruthy(),
    );
    const addButtons = app.view.getAllByText('Add Server');
    app.rtl.fireEvent.press(addButtons[addButtons.length - 1]);
    await app.rtl.waitFor(() =>
      expect(app.view.getByText(FIRST_NAME)).toBeTruthy(),
    );
    await app.rtl.waitFor(() =>
      expect(
        app.view.queryByPlaceholderText('e.g., Off Grid AI Desktop'),
      ).toBeNull(),
    );

    await app.rtl.waitFor(async () => {
      const stored = await app.asyncStorage.getItem('remote-servers');
      expect(stored).not.toContain(SECRET);
    });
    const logged = [console.log, console.warn, console.error]
      .flatMap(method => (method as jest.Mock).mock.calls)
      .flat()
      .join(' ');
    expect(logged).not.toContain(SECRET);

    pressAccessibleText(app, 'Edit');
    await app.rtl.waitFor(() =>
      expect(app.view.getByText('Edit Server')).toBeTruthy(),
    );
    const nameInput = await app.rtl.waitFor(() =>
      app.view.getByPlaceholderText('e.g., Off Grid AI Desktop'),
    );
    app.rtl.fireEvent.changeText(nameInput, EDITED_NAME);
    app.rtl.fireEvent.press(app.view.getByText('Test Connection'));
    await app.rtl.waitFor(() =>
      expect(app.view.getByText(/Connected \(/)).toBeTruthy(),
    );
    app.rtl.fireEvent.press(app.view.getByText('Update Server'));
    await app.rtl.waitFor(() => {
      expect(app.view.getByText(EDITED_NAME)).toBeTruthy();
      expect(app.view.queryByText(FIRST_NAME)).toBeNull();
    });
    await app.rtl.waitFor(() =>
      expect(
        app.view.queryByPlaceholderText('e.g., Off Grid AI Desktop'),
      ).toBeNull(),
    );

    app.rtl.fireEvent.press(app.view.getByText('Add Another Server'));
    await fillAndTestServer(app, SECOND_NAME, SECOND_ENDPOINT);
    await app.rtl.waitFor(() =>
      expect(app.view.getByText(/Connected \(/)).toBeTruthy(),
    );
    const secondAddButtons = app.view.getAllByText('Add Server');
    app.rtl.fireEvent.press(secondAddButtons[secondAddButtons.length - 1]);
    await app.rtl.waitFor(() => {
      expect(app.view.getByText(EDITED_NAME)).toBeTruthy();
      expect(app.view.getByText(SECOND_NAME)).toBeTruthy();
    });

    app.rtl.fireEvent.press(app.view.getByTestId('remote-servers-back-button'));
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByTestId('home-tab')),
    );
    await openTextModelPickerThroughHome(app.rtl, app.view);
    await app.rtl.waitFor(() =>
      expect(app.view.getByText('alpha-model')).toBeTruthy(),
    );
    await pressRemoteModelNamed(app, 'alpha-model');
    await app.rtl.waitFor(() =>
      expect(app.view.getByTestId('new-chat-button')).toBeTruthy(),
    );

    await openTextModelPickerThroughHome(app.rtl, app.view);
    await app.rtl.waitFor(() =>
      expect(app.view.getByText('beta-model')).toBeTruthy(),
    );
    await pressRemoteModelNamed(app, 'beta-model');
    await app.rtl.waitFor(() =>
      expect(app.view.getByTestId('new-chat-button')).toBeTruthy(),
    );

    app.rtl.fireEvent.press(app.view.getByTestId('settings-tab'));
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByText('Remote Servers')),
    );
    await app.rtl.waitFor(() =>
      expect(app.view.getByText(SECOND_NAME)).toBeTruthy(),
    );
    const deleteButtons = app.view.getAllByText('Delete');
    app.rtl.fireEvent.press(deleteButtons[deleteButtons.length - 1]);
    await app.rtl.waitFor(() =>
      expect(app.view.getByText('Delete Server')).toBeTruthy(),
    );
    const confirmationButtons = app.view.getAllByText('Delete');
    app.rtl.fireEvent.press(
      confirmationButtons[confirmationButtons.length - 1],
    );
    await app.rtl.waitFor(() => {
      expect(app.view.queryByText(SECOND_NAME)).toBeNull();
      expect(app.view.getByText(EDITED_NAME)).toBeTruthy();
    });

    app.rtl.fireEvent.press(app.view.getByTestId('remote-servers-back-button'));
    app.rtl.fireEvent.press(
      await app.rtl.waitFor(() => app.view.getByTestId('home-tab')),
    );
    await openTextModelPickerThroughHome(app.rtl, app.view);
    await app.rtl.waitFor(() => {
      expect(app.view.queryByText('beta-model')).toBeNull();
      expect(app.view.getByText('alpha-model')).toBeTruthy();
    });
    await pressRemoteModelNamed(app, 'alpha-model');
    await app.rtl.waitFor(() =>
      expect(app.view.getByTestId('new-chat-button')).toBeTruthy(),
    );
    app.view.unmount();
  }, 30000);
});
