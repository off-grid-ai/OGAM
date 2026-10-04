import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

let fixture: MobileApplicationFixture | null = null;
let originalFetch: typeof global.fetch;

describe('Home remote text model lifecycle', () => {
  beforeAll(async () => {
    installNativeBoundary({ download: true, fs: true, llama: true, whisper: true });
    originalFetch = global.fetch;
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture();
  });

  afterEach(async () => {
    requireRTL().cleanup();
    const servers = fixture!.application.models.snapshot().servers;
    for (const server of servers) {
      await fixture!.application.models.removeRemoteServer(server.id);
    }
    global.fetch = originalFetch;
  });

  afterAll(async () => {
    await fixture?.dispose();
    fixture = null;
  });

  const activateRemoteText = async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({
      object: 'list', data: [{ id: 'Llama-3.2-3B' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const saved = await fixture!.application.models.saveRemoteServer({
      name: 'Home server',
      endpoint: 'http://192.168.1.2:8000/v1',
      provider: 'openai-compatible',
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved.failure));
    const discovered = await fixture!.application.models.discoverRemoteServers(saved.value.id);
    if (!discovered.ok) throw new Error(JSON.stringify(discovered.failure));
    const activated = await fixture!.application.models.activateOnServer(
      saved.value.id,
      'text',
      'Llama-3.2-3B',
    );
    if (!activated.ok) throw new Error(JSON.stringify(activated.failure));
  };

  const renderHome = () => {
    const React = require('react');
    const rtl = requireRTL();
    const { NavigationContainer } = require('@react-navigation/native');
    const { createNativeStackNavigator } = require('@react-navigation/native-stack');
    const { HomeScreen } = require('../../../src/screens/HomeScreen');
    const { ChatScreen } = require('../../../src/screens/ChatScreen');
    const Stack = createNativeStackNavigator();
    let currentRoute: { name: string; params?: object } = { name: 'Home' };
    const view = rtl.render(React.createElement(
      NavigationContainer,
      { onStateChange: (state: { routes: Array<{ name: string; params?: object }>; index: number }) => {
        currentRoute = state.routes[state.index] ?? currentRoute;
      } },
      React.createElement(
        Stack.Navigator,
        { initialRouteName: 'Home', screenOptions: { headerShown: false } },
        React.createElement(Stack.Screen, { name: 'Home', component: HomeScreen }),
        React.createElement(Stack.Screen, { name: 'Chat', component: ChatScreen }),
      ),
    ));
    return { rtl, view, currentRoute: () => currentRoute };
  };

  const openEjectConfirmation = async () => {
    await activateRemoteText();
    const rendered = renderHome();
    rendered.rtl.fireEvent.press(rendered.view.getByTestId('models-summary'));
    rendered.rtl.fireEvent.press(await rendered.view.findByText('Eject All Models'));
    await rendered.view.findByText('Unload all active models to free up memory?');
    return rendered;
  };

  it('shows New Chat for an active remote text model', async () => {
    await activateRemoteText();
    const { view } = renderHome();
    expect(await view.findByTestId('new-chat-button')).toBeTruthy();
  });

  it('opens the real Chat route without creating a conversation eagerly', async () => {
    await activateRemoteText();
    const { rtl, view, currentRoute } = renderHome();
    rtl.fireEvent.press(await view.findByTestId('new-chat-button'));
    await rtl.waitFor(() => expect(currentRoute().name).toBe('Chat'));
    expect(currentRoute().params).toEqual({});
  });

  it('shows the eject-all action and confirmation', async () => {
    const { view } = await openEjectConfirmation();
    expect(view.getByText('Cancel')).toBeTruthy();
    expect(view.getByText('Eject All')).toBeTruthy();
  });

  it('keeps the model active when eject-all is cancelled', async () => {
    const { rtl, view } = await openEjectConfirmation();
    rtl.fireEvent.press(view.getByText('Cancel'));
    expect(fixture!.application.models.activeModelId('text')).not.toBeNull();
    expect(view.getByTestId('new-chat-button')).toBeTruthy();
  });

  it('ejects the model and shows the public result', async () => {
    const { rtl, view } = await openEjectConfirmation();
    rtl.fireEvent.press(view.getByText('Eject All'));
    await rtl.waitFor(() =>
      expect(fixture!.application.models.activeModelId('text')).toBeNull(),
    );
    expect(await view.findByText('Unloaded 1 model')).toBeTruthy();
    expect(view.queryByTestId('new-chat-button')).toBeNull();
  });

  it('selects a discovered model without an eager runtime load or memory warning', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({
      object: 'list', data: [{ id: 'Llama-3.2-3B' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const saved = await fixture!.application.models.saveRemoteServer({
      name: 'Picker server',
      endpoint: 'http://192.168.1.3:8000/v1',
      provider: 'openai-compatible',
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved.failure));
    const discovered = await fixture!.application.models.discoverRemoteServers(saved.value.id);
    if (!discovered.ok) throw new Error(JSON.stringify(discovered.failure));
    const { rtl, view } = renderHome();
    rtl.fireEvent.press(view.getByTestId('models-summary'));
    rtl.fireEvent.press(await view.findByTestId('models-row-text'));
    rtl.fireEvent.press(await view.findByTestId('remote-model-item'));
    await rtl.waitFor(() =>
      expect(fixture!.application.models.activeModelId('text')).toContain('Llama-3.2-3B'),
    );
    expect(fixture!.application.models.snapshot().residents).toHaveLength(0);
    expect(view.queryByText('Insufficient Memory')).toBeNull();
    expect(view.queryByText('Low Memory Warning')).toBeNull();
    expect(view.queryByText('Load Anyway')).toBeNull();
  });
});
