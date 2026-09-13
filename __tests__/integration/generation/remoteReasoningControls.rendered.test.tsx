import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RemoteServerEditorScreen } from '../../../src/screens/RemoteServerEditorScreen';
import { RemoteServersScreen } from '../../../src/screens/RemoteServersScreen';
import { ChatScreen } from '../../../src/screens/ChatScreen';

// Use the real navigator. The Jest setup replaces only native screen views.
jest.unmock('@react-navigation/native');

const Stack = createNativeStackNavigator();
const MODELS = [
  { id: 'boolean-model', name: 'Boolean Model', object: 'model' },
];

/** The LAN server and its native stream are the only test-owned boundaries. */
function installServerBoundary(): () => void {
  const oldFetch = global.fetch;
  const oldXHR = global.XMLHttpRequest;
  const response = (body: unknown, ok = true): Response => ({
    ok, status: ok ? 200 : 404,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/v1/models')) return response({ object: 'list', data: MODELS });
    if (url.endsWith('/api/show')) {
      return response({
        capabilities: ['thinking'],
        model_info: { 'llama.context_length': 8192 },
        template: '{{ if .Think }} reasoning {{ end }}',
      });
    }
    return response({}, false);
  }) as typeof global.fetch;

  class ServerStream {
    responseText = '';
    responseURL = '';
    readyState = 0;
    status = 0;
    onprogress: (() => void) | null = null;
    onreadystatechange: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    open(_method: string, url: string): void { this.responseURL = url; }
    setRequestHeader(): void {}
    abort(): void {}
    send(body: string): void {
      const request = JSON.parse(body) as { think?: boolean | string };
      const mode = request.think === true ? 'on' : request.think === false ? 'off' : request.think;
      const lines = [
        ...(request.think === false ? [] : [{ message: { thinking: 'The server reasoned.' } }]),
        { message: { content: `Server received Thinking ${mode}.` } },
        { message: { content: '' }, done: true },
      ];
      setTimeout(() => {
        this.responseText = `${lines.map(line => JSON.stringify(line)).join('\n')}\n`;
        this.onprogress?.();
        this.readyState = 4;
        this.status = 200;
        this.onreadystatechange?.();
      }, 0);
    }
  }
  global.XMLHttpRequest = ServerStream as unknown as typeof XMLHttpRequest;
  return () => {
    global.fetch = oldFetch;
    global.XMLHttpRequest = oldXHR;
  };
}

function renderRoute(name: 'RemoteServers' | 'Chat') {
  return render(
    <NavigationContainer>
      <Stack.Navigator initialRouteName={name}>
        <Stack.Screen name="RemoteServers" component={RemoteServersScreen} />
        <Stack.Screen name="RemoteServerEditor" component={RemoteServerEditorScreen} />
        <Stack.Screen name="Chat" component={ChatScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

describe('remote reasoning controls through the Mobile chat UI', () => {
  it('uses the same Thinking toggle to start and stop reasoning on a remote model', async () => {
    const restoreServer = installServerBoundary();
    try {
      const editor = renderRoute('RemoteServers');
      fireEvent.press(editor.getByTestId('add-server'));
      await waitFor(() => expect(editor.queryByTestId('server-name')).not.toBeNull());
      fireEvent.changeText(editor.getByTestId('server-name'), 'Ollama');
      fireEvent.changeText(editor.getByTestId('server-endpoint'), 'http://localhost:11434');
      fireEvent.press(editor.getByTestId('test-connection'));
      await waitFor(() => expect(editor.queryByText(/Connected \(/)).not.toBeNull());
      fireEvent.press(editor.getByTestId('save-server'));
      await waitFor(() => expect(editor.queryByTestId('server-name')).toBeNull());
      editor.unmount();

      const chat = renderRoute('Chat');
      fireEvent.press(await waitFor(() => chat.getByText('Select Model')));
      fireEvent.press(await waitFor(() => chat.getByText('Boolean Model')));
      fireEvent.press(await waitFor(() => chat.getByTestId('quick-settings-button')));
      const thinking = await waitFor(() => chat.getByTestId('quick-thinking-toggle'));
      fireEvent.press(thinking);
      fireEvent.changeText(chat.getByTestId('chat-input'), 'First turn');
      fireEvent.press(chat.getByTestId('send-button'));
      await waitFor(() => expect(chat.queryByText(/Server received Thinking on/)).not.toBeNull());

      fireEvent.press(chat.getByTestId('quick-settings-button'));
      fireEvent.press(await waitFor(() => chat.getByTestId('quick-thinking-toggle')));
      fireEvent.changeText(chat.getByTestId('chat-input'), 'Second turn');
      fireEvent.press(chat.getByTestId('send-button'));
      await waitFor(() => expect(chat.queryByText(/Server received Thinking off/)).not.toBeNull());
      await waitFor(() => expect(chat.queryByTestId('stop-button')).toBeNull());
      chat.unmount();
    } finally {
      restoreServer();
    }
  }, 20_000);
});
