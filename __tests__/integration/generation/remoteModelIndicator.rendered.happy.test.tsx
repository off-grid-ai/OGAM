/**
 * A remote model is visibly different from a local model in the real selector.
 *
 * The real editor, stores, services, selector, and Shared application run over device,
 * HTTP, and navigation boundaries only.
 */
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import { installNativeBoundary } from '../../harness/nativeBoundary';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => ({ params: undefined }),
  useIsFocused: () => true,
  useFocusEffect: () => {},
}));

describe('remote model indicator', () => {
  let fixture: MobileApplicationFixture;
  let React: typeof import('react');
  let rtl: typeof import('@testing-library/react-native');
  let RemoteServerEditorScreen: typeof import('../../../src/screens/RemoteServerEditorScreen').RemoteServerEditorScreen;
  let ModelSelectorModal: typeof import('../../../src/components/ModelSelectorModal').ModelSelectorModal;
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
    ({ RemoteServerEditorScreen } =
      require('../../../src/screens/RemoteServerEditorScreen') as typeof import('../../../src/screens/RemoteServerEditorScreen'));
    ({ ModelSelectorModal } =
      require('../../../src/components/ModelSelectorModal') as typeof import('../../../src/components/ModelSelectorModal'));
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture();
  });

  afterAll(async () => {
    await fixture.dispose();
    global.fetch = realFetch;
  });

  const openSelector = () =>
    rtl.render(
      React.createElement(ModelSelectorModal, {
        visible: true,
        onClose: () => {},
        onSelectModel: () => {},
        onUnloadModel: () => {},
        isLoading: false,
      }),
    );

  it('marks the remote model under its server heading', async () => {
    const before = openSelector();
    expect(before.queryByText('Remote')).toBeNull();
    expect(before.queryByText('My LM Studio')).toBeNull();
    before.unmount();

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

    const selector = openSelector();
    await rtl.waitFor(() =>
      expect(selector.queryByText('llama-3-8b')).not.toBeNull(),
    );
    expect(selector.queryByText('My LM Studio')).not.toBeNull();
    expect(selector.queryByText('Remote')).not.toBeNull();
    selector.unmount();
  });
});
