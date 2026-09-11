/**
 * The Home models sheet marks a selected remote text model with its cloud indicator.
 *
 * The real editor, Home screen, stores, services, and Shared application run over
 * native, HTTP, and navigation boundaries only.
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

describe('Models manager sheet remote indicator', () => {
  let fixture: MobileApplicationFixture;
  let React: typeof import('react');
  let rtl: typeof import('@testing-library/react-native');
  let RemoteServerEditorScreen: typeof import('../../../src/screens/RemoteServerEditorScreen').RemoteServerEditorScreen;
  let HomeScreen: typeof import('../../../src/screens/HomeScreen').HomeScreen;
  let realFetch: typeof global.fetch;

  const setup = async () => {
    realFetch = global.fetch;
    mockGoBack.mockClear();
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
    ({ RemoteServerEditorScreen } =
      require('../../../src/screens/RemoteServerEditorScreen') as typeof import('../../../src/screens/RemoteServerEditorScreen'));
    ({ HomeScreen } =
      require('../../../src/screens/HomeScreen') as typeof import('../../../src/screens/HomeScreen'));
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture();
  };

  afterEach(async () => {
    await fixture.dispose();
    global.fetch = realFetch;
  });

  const connectServer = async () => {
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
  };

  const renderHome = () =>
    rtl.render(
      React.createElement(HomeScreen, {
        navigation: {
          navigate: () => {},
          goBack: () => {},
          setOptions: () => {},
          addListener: () => () => {},
        } as never,
      }),
    );

  it('shows the cloud marker after the user selects a remote text model', async () => {
    await setup();
    await connectServer();
    const home = renderHome();

    rtl.fireEvent.press(await home.findByTestId('browse-models-button'));
    rtl.fireEvent.press(await home.findByTestId('remote-model-item'));
    rtl.fireEvent.press(await home.findByTestId('models-summary'));

    await rtl.waitFor(() =>
      expect(home.queryByTestId('models-row-text-remote')).not.toBeNull(),
    );
    home.unmount();
  });

  it('shows no cloud marker before a remote model is selected', async () => {
    await setup();
    await connectServer();
    const home = renderHome();

    rtl.fireEvent.press(await home.findByTestId('models-summary'));
    await rtl.waitFor(() =>
      expect(home.queryByTestId('models-row-text')).not.toBeNull(),
    );
    expect(home.queryByTestId('models-row-text-remote')).toBeNull();
    home.unmount();
  });
});
