import React from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { RemoteModelOptionsSection } from '../../../src/components/models/RemoteModelOptionsSection';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';

describe('remote media model pickers', () => {
  beforeEach(() => {
    useRemoteServerStore.getState().clearAllServers();
  });

  function addGateway(): string {
    return useRemoteServerStore.getState().addServer({
      name: 'Studio Mac',
      endpoint: 'http://192.168.1.50:7878', // NOSONAR - private LAN test fixture
      providerType: 'openai-compatible',
      mediaModels: {
        transcription: '/models/whisper-base.bin',
        voice: '/models/kokoro.pte',
      },
      modelCatalog: {
        transcription: [
          { id: '/models/whisper-base.bin', name: 'Whisper Base' },
          { id: '/models/whisper-large-v3.bin', name: 'Whisper Large v3' },
        ],
        voice: [
          { id: '/models/kokoro.pte', name: 'Kokoro' },
          { id: '/models/orpheus.pte', name: 'Orpheus' },
        ],
      },
    });
  }

  it('changes the active transcription model and shows human names', async () => {
    const serverId = addGateway();
    const ui = render(<RemoteModelOptionsSection category="transcription" />);

    expect(ui.getByText('Whisper Large v3')).toBeTruthy();
    expect(ui.queryByText('/models/whisper-large-v3.bin')).toBeNull();
    fireEvent.press(
      ui.getByTestId(
        `remote-transcription-model-${serverId}:/models/whisper-large-v3.bin`,
      ),
    );

    await waitFor(() =>
      expect(
        useRemoteServerStore.getState().getServerById(serverId)?.mediaModels
          ?.transcription,
      ).toBe('/models/whisper-large-v3.bin'),
    );
    ui.unmount();
  });

  it('shows each remote voice model on a full card: what it does and the computer it runs on', () => {
    const serverId = addGateway();
    const ui = render(<RemoteModelOptionsSection category="voice" />);

    const card = ui.getByTestId(`remote-voice-model-${serverId}:/models/orpheus.pte`);
    expect(within(card).getByText('Orpheus')).toBeTruthy();
    expect(within(card).getByText('Voice · Runs on Studio Mac')).toBeTruthy();
    expect(within(card).queryByText('/models/orpheus.pte')).toBeNull();
    ui.unmount();
  });

  it('changes the active voice model without changing the raw server model ID', async () => {
    const serverId = addGateway();
    const textServerId = useRemoteServerStore.getState().addServer({
      name: 'Text Mac',
      endpoint: 'http://192.168.1.51:7878', // NOSONAR - private LAN test fixture
      providerType: 'openai-compatible',
    });
    useRemoteServerStore.getState().setActiveServerId(textServerId);
    const ui = render(<RemoteModelOptionsSection category="voice" />);

    fireEvent.press(
      ui.getByTestId(`remote-voice-model-${serverId}:/models/orpheus.pte`),
    );

    await waitFor(() => {
      const state = useRemoteServerStore.getState();
      expect(state.activeServerId).toBe(textServerId);
      expect(state.activeRemoteMediaServerIds.voice).toBe(serverId);
      expect(state.getServerById(serverId)?.mediaModels?.voice).toBe(
        '/models/orpheus.pte',
      );
    });
    expect(ui.getByText('Orpheus')).toBeTruthy();
    ui.unmount();
  });
});
