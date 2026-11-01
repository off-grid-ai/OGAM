/**
 * ChatInputModeToggle tests
 *
 * The pro-only Text/Voice interface control is one direct icon toggle:
 *  - when the voice model is NOT downloaded → prompts, then routes to the Models Voice tab
 *  - when downloaded (or a remote voice model is active) → flips interfaceMode inline (chat→audio)
 *  - when the control is disabled → does nothing
 *
 * The real toggle runs on a real stack navigator with the real TTS and remote-server stores and the
 * real haptics helper (the haptic engine is faked in jest.setup). State is written through the
 * stores' own actions. Each test reads the mode the person ends in and the screen they are on.
 */
jest.unmock('@react-navigation/native');

import React from 'react';
import { Platform, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ChatInputModeToggle } from '../../../pro/audio/ui/ChatInputModeToggle';
import { useTTSStore } from '../../../pro/audio/ttsStore';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';

const Stack = createNativeStackNavigator();
const MainStub = () => <Text>Main screen</Text>;

function mount(props: React.ComponentProps<typeof ChatInputModeToggle> = {}) {
  const ref = createNavigationContainerRef<Record<string, object | undefined>>();
  const Chat = () => <ChatInputModeToggle {...props} />;
  const view = render(
    <NavigationContainer ref={ref}>
      <Stack.Navigator>
        <Stack.Screen name="Chat" component={Chat} />
        <Stack.Screen name="Main" component={MainStub} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  return { view, route: () => ref.getCurrentRoute() };
}

/** Whether this phone has the voice model, and which mode the chat is in. */
function voiceModel(downloaded: boolean, mode: 'chat' | 'audio' = 'chat') {
  const { settings, updateSettings } = useTTSStore.getState();
  updateSettings({ modelDownloaded: { [settings.engineId]: downloaded }, interfaceMode: mode });
}

const mode = () => useTTSStore.getState().settings.interfaceMode;

describe('ChatInputModeToggle', () => {
  const realOS = Platform.OS;

  beforeEach(() => {
    useTTSStore.setState({ isReady: false });
    voiceModel(false, 'chat');
    const remote = useRemoteServerStore.getState();
    remote.setActiveRemoteMediaServerId('voice', null);
    for (const server of [...remote.servers]) remote.removeServer(server.id);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: realOS, configurable: true });
  });

  it('with no voice model, prompts instead of switching, and "Get voice model" opens the Models Voice tab', async () => {
    // Android: the prompt shows inline. On iOS it waits for the dropdown's onDismiss (one modal at
    // a time), which jest's Modal cannot fire; that sequencing is checked on the device.
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const { view, route } = mount();

    fireEvent.press(view.getByTestId('chat-mode-toggle'));

    expect(view.getByText('Get voice model')).toBeTruthy();
    expect(route()?.name).toBe('Chat');
    expect(mode()).toBe('chat');

    fireEvent.press(view.getByText('Get voice model'));

    await waitFor(() => expect(route()?.name).toBe('Main'));
    expect(route()?.params).toEqual({ screen: 'ModelsTab', params: { initialTab: 'voice' } });
    expect(mode()).toBe('chat');
  });

  it('with the voice model downloaded, switches to voice in place', () => {
    voiceModel(true, 'chat');
    const { view, route } = mount();

    fireEvent.press(view.getByTestId('chat-mode-toggle'));

    expect(mode()).toBe('audio');
    expect(route()?.name).toBe('Chat');
  });

  it('with a remote voice model active, switches to voice in place', () => {
    act(() => {
      const remote = useRemoteServerStore.getState();
      const id = remote.addServer({
        name: 'Desktop',
        endpoint: 'http://192.168.1.10:7878',
        providerType: 'openai-compatible',
        mediaModels: { voice: 'kokoro' },
      });
      remote.setActiveRemoteMediaServerId('voice', id);
    });
    const { view, route } = mount();

    fireEvent.press(view.getByTestId('chat-mode-toggle'));

    expect(mode()).toBe('audio');
    expect(route()?.name).toBe('Chat');
  });

  it('does nothing while disabled', () => {
    voiceModel(true, 'chat');
    const { view } = mount({ disabled: true });

    fireEvent.press(view.getByTestId('chat-mode-toggle'));

    expect(mode()).toBe('chat');
    expect(view.queryByText('Get voice model')).toBeNull();
  });
});
