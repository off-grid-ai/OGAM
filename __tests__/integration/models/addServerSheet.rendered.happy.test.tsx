/**
 * Full-screen remote-server editor through the real form, manager, store, Keychain adapter, and
 * HTTP client. Only the network and navigation hosts are test boundaries.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RemoteServerEditorScreen } from '../../../src/screens/RemoteServerEditorScreen';
import { RemoteServersScreen } from '../../../src/screens/RemoteServersScreen';
import { useRemoteServerStore } from '../../../src/stores';
import {
  gatewayModelList,
  installLanProbe,
  type LanProbeHandle,
} from '../../harness/lanProbe';
import { withNavigator } from '../../harness/realNavigation';

const mockRoute: { params?: { serverId?: string } } = {};
const mockGoBack = jest.fn();

// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');

const MAC = '192.168.1.30:7878';

describe('full-screen remote server editor', () => {
  let lan: LanProbeHandle;

  beforeEach(() => {
    mockRoute.params = undefined;
    mockGoBack.mockClear();
    useRemoteServerStore.getState().clearAllServers();
    const DeviceInfo = require('react-native-device-info');
    DeviceInfo.isEmulator = jest.fn(async () => false);
    DeviceInfo.getIpAddress = jest.fn(async () => '192.168.1.10');
    lan = installLanProbe({
      [MAC]: { paths: ['/v1/'], body: gatewayModelList },
    });
  });

  afterEach(() => lan.uninstall());

  it('rejects an invalid address before it creates a server', async () => {
    const ui = render(withNavigator(<RemoteServerEditorScreen />));
    fireEvent.changeText(ui.getByTestId('server-name'), 'Study Mac');
    fireEvent.changeText(ui.getByTestId('server-endpoint'), 'not-a-url');
    fireEvent.press(ui.getByTestId('test-connection'));

    await waitFor(() =>
      expect(ui.getByText('Invalid URL format')).toBeTruthy(),
    );
    expect(useRemoteServerStore.getState().servers).toHaveLength(0);
  });

  it('states when media leaves the phone and when it stays on the local network', async () => {
    const ui = render(withNavigator(<RemoteServerEditorScreen />));
    const address = ui.getByTestId('server-endpoint');

    fireEvent.changeText(address, `http://${MAC}`);
    expect(
      ui.getByText(
        'A server on your network keeps requests between your devices.',
      ),
    ).toBeTruthy();

    fireEvent.changeText(address, 'https://api.example.com');
    await waitFor(() =>
      expect(
        ui.getByText(/prompts, images, and audio leave this phone/),
      ).toBeTruthy(),
    );
    expect(
      ui.getByText('The key stays in Keychain on this phone.'),
    ).toBeTruthy();
  });

  it('saves media model IDs and shows the named server in the list', async () => {
    const editor = render(withNavigator(<RemoteServerEditorScreen />));
    fireEvent.changeText(editor.getByTestId('server-name'), 'Study Mac');
    fireEvent.changeText(
      editor.getByTestId('server-endpoint'),
      `http://${MAC}`,
    );
    fireEvent.changeText(
      editor.getByPlaceholderText('gpt-image-1'),
      'flux-schnell',
    );
    fireEvent.changeText(
      editor.getByPlaceholderText('whisper-1'),
      'whisper-large-v3',
    );
    fireEvent.changeText(
      editor.getByPlaceholderText('gpt-4o-mini-tts'),
      'kokoro',
    );
    fireEvent.press(editor.getByTestId('test-connection'));
    await waitFor(() => expect(editor.getByText(/Connected/)).toBeTruthy());
    fireEvent.press(editor.getByTestId('save-server'));

    await waitFor(() =>
      expect(useRemoteServerStore.getState().servers).toHaveLength(1),
    );
    expect(useRemoteServerStore.getState().servers[0]?.mediaModels).toEqual({
      text: 'Qwen3.5-0.8B-GGUF',
      image: 'flux-schnell',
      transcription: 'whisper-large-v3',
      voice: 'kokoro',
    });
    expect(useRemoteServerStore.getState().servers[0]).not.toHaveProperty(
      'apiKey',
    );

    editor.unmount();
    const list = render(withNavigator(<RemoteServersScreen />));
    await waitFor(() => expect(list.getByText('Study Mac')).toBeTruthy());
  });

  it('shows human model names and saves a selected model for every declared category', async () => {
    lan.uninstall();
    lan = installLanProbe({
      [MAC]: {
        paths: ['/v1/'],
        body: {
          object: 'list',
          data: [
            {
              id: '/srv/models/Qwen3.5-9B-Q4_K_M.gguf',
              name: 'Qwen 3.5 9B',
              kind: 'chat',
            },
            {
              id: '/srv/models/Llama-3.2-3B.gguf',
              name: 'Llama 3.2 3B',
              kind: 'chat',
            },
            {
              id: '/srv/models/flux.safetensors',
              name: 'Flux Schnell',
              kind: 'image',
            },
            { id: '/srv/models/sdxl.safetensors', name: 'SDXL', kind: 'image' },
            {
              id: '/srv/models/whisper-large-v3.bin',
              name: 'Whisper Large v3',
              kind: 'transcription',
            },
            { id: '/srv/models/kokoro.pte', name: 'Kokoro', kind: 'speech' },
          ],
        },
      },
    });
    const editor = render(withNavigator(<RemoteServerEditorScreen />));
    fireEvent.changeText(editor.getByTestId('server-name'), 'Studio Mac');
    fireEvent.changeText(
      editor.getByTestId('server-endpoint'),
      `http://${MAC}`,
    );
    fireEvent.press(editor.getByTestId('test-connection'));

    await waitFor(() => expect(editor.getByText('Qwen 3.5 9B')).toBeTruthy());
    expect(editor.queryByText('/srv/models/Qwen3.5-9B-Q4_K_M.gguf')).toBeNull();
    expect(editor.getByText('Flux Schnell')).toBeTruthy();
    expect(editor.getByText('Whisper Large v3')).toBeTruthy();
    expect(editor.getByText('Kokoro')).toBeTruthy();

    fireEvent.press(editor.getByTestId('server-text-model'));
    fireEvent.press(
      editor.getByTestId(
        'server-text-model-option-/srv/models/Llama-3.2-3B.gguf',
      ),
    );
    await waitFor(() => expect(editor.getByText('Llama 3.2 3B')).toBeTruthy());
    fireEvent.press(editor.getByTestId('server-image-model'));
    fireEvent.press(
      editor.getByTestId(
        'server-image-model-option-/srv/models/sdxl.safetensors',
      ),
    );
    await waitFor(() => expect(editor.getByText('SDXL')).toBeTruthy());

    fireEvent.press(editor.getByTestId('save-server'));
    await waitFor(() =>
      expect(useRemoteServerStore.getState().servers).toHaveLength(1),
    );
    expect(useRemoteServerStore.getState().servers[0]?.mediaModels).toEqual({
      text: '/srv/models/Llama-3.2-3B.gguf',
      image: '/srv/models/sdxl.safetensors',
      transcription: '/srv/models/whisper-large-v3.bin',
      voice: '/srv/models/kokoro.pte',
    });
    editor.unmount();
  });
});
