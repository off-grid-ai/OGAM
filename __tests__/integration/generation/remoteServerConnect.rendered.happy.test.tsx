/**
 * Adding a reachable remote server renders its connected state.
 *
 * The real editor, list, stores, services, and Shared application run over native,
 * HTTP, and navigation boundaries only.
 */
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import { installNativeBoundary } from '../../harness/nativeBoundary';

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: mockGoBack,
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => ({ params: undefined }),
  useIsFocused: () => true,
  useFocusEffect: () => {},
}));

describe('remote server connection', () => {
  let fixture: MobileApplicationFixture;
  let React: typeof import('react');
  let rtl: typeof import('@testing-library/react-native');
  let RemoteServersScreen: typeof import('../../../src/screens/RemoteServersScreen').RemoteServersScreen;
  let RemoteServerEditorScreen: typeof import('../../../src/screens/RemoteServerEditorScreen').RemoteServerEditorScreen;
  const realFetch = global.fetch;

  beforeAll(async () => {
    installNativeBoundary({ download: true, fs: true });
    await require('@react-native-async-storage/async-storage').clear();
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/v1/models')) {
        return new Response(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'llama-3-8b', object: 'model', owned_by: 'local' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    React = require('react') as typeof import('react');
    const { requireRTL } =
      require('../../harness/nativeBoundary') as typeof import('../../harness/nativeBoundary');
    rtl = requireRTL();
    ({ RemoteServersScreen } =
      require('../../../src/screens/RemoteServersScreen') as typeof import('../../../src/screens/RemoteServersScreen'));
    ({ RemoteServerEditorScreen } =
      require('../../../src/screens/RemoteServerEditorScreen') as typeof import('../../../src/screens/RemoteServerEditorScreen'));
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture();
  });

  afterAll(async () => {
    await fixture.dispose();
    global.fetch = realFetch;
  });

  it('shows the added server as Connected', async () => {
    const editor = rtl.render(React.createElement(RemoteServerEditorScreen));
    rtl.fireEvent.changeText(
      editor.getByPlaceholderText('Off Grid AI Desktop'),
      'My LM Studio',
    );
    rtl.fireEvent.changeText(
      editor.getByPlaceholderText('http://192.168.1.50:7878'),
      'http://localhost:1234',
    );

    rtl.fireEvent.press(editor.getByTestId('test-connection'));
    await rtl.waitFor(() =>
      expect(editor.queryByText(/Connected \(/)).not.toBeNull(),
    );
    rtl.fireEvent.press(editor.getByTestId('save-server'));
    await rtl.waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    editor.unmount();

    const list = rtl.render(React.createElement(RemoteServersScreen));
    await rtl.waitFor(() =>
      expect(list.queryByText('My LM Studio')).not.toBeNull(),
    );
    await rtl.waitFor(() =>
      expect(list.queryByText('Connected')).not.toBeNull(),
    );
    list.unmount();
  });
});
