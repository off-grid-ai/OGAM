import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RemoteServersScreen } from '../../../src/screens/RemoteServersScreen';
import { RemoteServerEditorScreen } from '../../../src/screens/RemoteServerEditorScreen';
import { ChatScreen } from '../../../src/screens/ChatScreen';
import { ThinkingBudgetSelector } from '../../../src/components/settings/textGenAdvancedSections';

jest.unmock('@react-navigation/native');

const Stack = createNativeStackNavigator();

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
    if (url.endsWith('/v1/models')) {
      return response({ object: 'list', data: [{ id: 'levels-model', name: 'Level Model', object: 'model' }] });
    }
    if (url.endsWith('/api/show')) {
      return response({
        capabilities: ['thinking'],
        details: { family: 'gptoss' },
        model_info: { 'gptoss.context_length': 8192 },
        template: '{{ if and .IsThinkSet .Think (ne .ThinkLevel "") }}Reasoning: {{ .ThinkLevel }}{{ else }}Reasoning: medium{{ end }}',
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
      const request = JSON.parse(body) as { think?: string };
      const lines = [
        { message: { thinking: 'The server reasoned.' } },
        { message: { content: `Server received Thinking ${request.think}.` } },
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

it('uses the existing budget for an Ollama model that accepts reasoning levels', async () => {
  const restoreServer = installServerBoundary();
  try {
    const editor = renderRoute('RemoteServers');
    fireEvent.press(editor.getByTestId('add-server'));
    fireEvent.changeText(await waitFor(() => editor.getByTestId('server-name')), 'Ollama');
    fireEvent.changeText(editor.getByTestId('server-endpoint'), 'http://localhost:11434');
    fireEvent.press(editor.getByTestId('test-connection'));
    await waitFor(() => expect(editor.queryByText(/Connected \(/)).not.toBeNull());
    fireEvent.press(editor.getByTestId('save-server'));
    await waitFor(() => expect(editor.queryByTestId('server-name')).toBeNull());
    editor.unmount();

    const budget = render(<ThinkingBudgetSelector />);
    fireEvent.press(budget.getByTestId('thinking-budget-8192-button'));
    budget.unmount();

    const chat = renderRoute('Chat');
    fireEvent.press(await waitFor(() => chat.getByText('Select Model')));
    fireEvent.press(await waitFor(() => chat.getByText('Level Model')));
    fireEvent.changeText(await waitFor(() => chat.getByTestId('chat-input')), 'Answer with reasoning');
    fireEvent.press(await waitFor(() => chat.getByTestId('send-button')));
    await waitFor(() => expect(chat.queryByText(/Server received Thinking high/)).not.toBeNull());
    fireEvent.press(chat.getByTestId('quick-settings-button'));
    await waitFor(() => expect(chat.queryByTestId('quick-thinking-toggle')).toBeNull());
    chat.unmount();
  } finally {
    restoreServer();
  }
}, 20_000);
