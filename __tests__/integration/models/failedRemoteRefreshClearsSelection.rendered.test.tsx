import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ModelsManagerSheet } from '../../../src/components/models/ModelsManagerSheet';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';

function ModelsSheet() {
  const textModel = useRemoteServerStore(state => state.activeRemoteTextModelId);
  const imageModel = useRemoteServerStore(state => state.activeRemoteImageModelId);
  const mediaServers = useRemoteServerStore(
    state => state.activeRemoteMediaServerIds,
  );

  return (
    <ModelsManagerSheet
      visible
      onClose={() => {}}
      labels={{
        text: textModel ?? 'Local text',
        image: imageModel ?? 'Local image',
        video: mediaServers.video ? 'Cloud video' : 'Local video',
        voice: mediaServers.voice ? 'Cloud voice' : 'Local voice',
        speech: mediaServers.transcription ? 'Cloud speech' : 'Local speech',
      }}
      remote={{
        text: !!textModel,
        image: !!mediaServers.image,
        video: !!mediaServers.video,
        voice: !!mediaServers.voice,
        speech: !!mediaServers.transcription,
      }}
      loadingState={{ isLoading: false }}
      isEjecting={false}
      hasActiveModel={false}
      onOpenRow={() => {}}
      onEject={() => {}}
    />
  );
}

describe('remote model refresh failure', () => {
  beforeEach(() => {
    const store = useRemoteServerStore.getState();
    store.clearAllServers();
    store.addServer(
      {
        name: 'Unavailable Gateway',
        endpoint: 'http://10.233.89.193:7878',
        providerType: 'openai-compatible',
        mediaModels: {
          image: 'cloud-image',
          video: 'cloud-video',
          transcription: 'cloud-speech',
          voice: 'cloud-voice',
        },
      },
      'unavailable-gateway',
    );
    store.setActiveServerId('unavailable-gateway');
    store.setActiveRemoteTextModelId('cloud-text');
    store.setActiveRemoteImageModelId('cloud-image');
    store.setActiveRemoteMediaServerId('image', 'unavailable-gateway');
    store.setActiveRemoteMediaServerId('video', 'unavailable-gateway');
    store.setActiveRemoteMediaServerId('transcription', 'unavailable-gateway');
    store.setActiveRemoteMediaServerId('voice', 'unavailable-gateway');
    global.fetch = async () =>
      new Response(JSON.stringify({ error: 'offline' }), { status: 503 });
  });

  it('unsets only the unreachable server models after Refresh Models', async () => {
    const view = render(<ModelsSheet />);
    expect(view.getAllByTestId(/models-row-.*-remote/)).toHaveLength(5);

    fireEvent.press(view.getByTestId('models-refresh-remote'));

    expect(await view.findByText('Could not refresh Unavailable Gateway.')).toBeTruthy();
    await waitFor(() => {
      expect(view.queryAllByTestId(/models-row-.*-remote/)).toHaveLength(0);
    });
    expect(view.getByText('Local text')).toBeTruthy();
    expect(view.getByText('Local image')).toBeTruthy();
    expect(view.getByText('Local video')).toBeTruthy();
    expect(view.getByText('Local voice')).toBeTruthy();
    expect(view.getByText('Local speech')).toBeTruthy();
  });
});
