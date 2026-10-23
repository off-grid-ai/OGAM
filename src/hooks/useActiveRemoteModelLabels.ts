import { selectedRemoteModelName } from '../services/remoteModelSelection';
import { useRemoteServerStore } from '../stores/remoteServerStore';

/** Human labels for the active server's selected media models. */
export function useActiveRemoteModelLabels(): {
  video: string | null;
  image: string | null;
  transcription: string | null;
  voice: string | null;
} {
  const servers = useRemoteServerStore(state => state.servers);
  const activeServerIds = useRemoteServerStore(
    state => state.activeRemoteMediaServerIds,
  );
  const serverFor = (category: 'video' | 'image' | 'transcription' | 'voice') =>
    servers.find(server => server.id === activeServerIds[category]);
  return {
    video: selectedRemoteModelName(serverFor('video'), 'video'),
    image: selectedRemoteModelName(serverFor('image'), 'image'),
    transcription: selectedRemoteModelName(
      serverFor('transcription'),
      'transcription',
    ),
    voice: selectedRemoteModelName(serverFor('voice'), 'voice'),
  };
}
