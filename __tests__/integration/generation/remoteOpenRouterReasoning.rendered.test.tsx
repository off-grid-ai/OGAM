import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RemoteServerEditorScreen } from '../../../src/screens/RemoteServerEditorScreen';
import { RemoteServersScreen } from '../../../src/screens/RemoteServersScreen';
import { ChatScreen } from '../../../src/screens/ChatScreen';
import { ThinkingBudgetSelector } from '../../../src/components/settings/textGenAdvancedSections';

jest.unmock('@react-navigation/native');

const Stack = createNativeStackNavigator();

function installOpenRouterBoundary(): () => void {
  const oldFetch = global.fetch;
  const oldXHR = global.XMLHttpRequest;
  const response = (body: unknown): Response => ({
    ok: true, status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

  global.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/v1/models')) {
      return response({
        data: [{
          id: 'qwen/qwen3-8b', name: 'Qwen3 8B',
          context_length: 131072,
          reasoning: { mandatory: false },
          supported_parameters: ['reasoning', 'tools'],
          architecture: { input_modalities: ['text'] },
        }],
      });
    }
    return { ...response({}), ok: false, status: 404 } as Response;
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
      const request = JSON.parse(body) as { reasoning?: { max_tokens?: number; effort?: string } };
      const label = request.reasoning?.max_tokens === 1024
        ? 'budget 1024'
        : request.reasoning?.effort === 'none' ? 'Thinking off' : 'unexpected reasoning setting';
      const frames = [
        ...(request.reasoning?.max_tokens === 1024
          ? [{ choices: [{ delta: { reasoning: 'The server reasoned.' } }] }]
          : []),
        { choices: [{ delta: { content: `Server received ${label}.` } }] },
      ];
      setTimeout(() => {
        const serializedFrames = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('');
        this.responseText = `${serializedFrames}data: [DONE]\n\n`;
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

it('uses the existing Thinking toggle and budget for an OpenRouter chat', async () => {
  const restoreServer = installOpenRouterBoundary();
  try {
    const editor = renderRoute('RemoteServers');
    fireEvent.press(editor.getByTestId('add-server'));
    fireEvent.changeText(await waitFor(() => editor.getByTestId('server-name')), 'OpenRouter');
    fireEvent.changeText(editor.getByTestId('server-endpoint'), 'https://openrouter.ai/api');
    fireEvent.press(editor.getByTestId('test-connection'));
    await waitFor(() => expect(editor.queryByText(/Connected \(/)).not.toBeNull());
    fireEvent.press(editor.getByTestId('save-server'));
    fireEvent.press(await waitFor(() => editor.getByText('Continue')));
    await waitFor(() => expect(editor.queryByTestId('server-name')).toBeNull());
    editor.unmount();

    const budget = render(<ThinkingBudgetSelector />);
    fireEvent.press(budget.getByTestId('thinking-budget-1024-button'));
    budget.unmount();

    const chat = renderRoute('Chat');
    fireEvent.press(await waitFor(() => chat.getByText('Select Model')));
    fireEvent.press(await waitFor(() => chat.getByText('Qwen3 8B')));
    fireEvent.press(await waitFor(() => chat.getByTestId('quick-settings-button')));
    fireEvent.press(await waitFor(() => chat.getByTestId('quick-thinking-toggle')));
    fireEvent.changeText(chat.getByTestId('chat-input'), 'First turn');
    fireEvent.press(chat.getByTestId('send-button'));
    await waitFor(() => expect(chat.queryByText('Server received budget 1024.')).not.toBeNull());

    fireEvent.press(chat.getByTestId('quick-settings-button'));
    fireEvent.press(await waitFor(() => chat.getByTestId('quick-thinking-toggle')));
    fireEvent.changeText(chat.getByTestId('chat-input'), 'Second turn');
    fireEvent.press(chat.getByTestId('send-button'));
    await waitFor(() => expect(chat.queryByText('Server received Thinking off.')).not.toBeNull());
    chat.unmount();
  } finally {
    restoreServer();
  }
}, 20_000);
