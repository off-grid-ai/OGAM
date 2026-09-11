import { useActiveMobileModel } from './useActiveMobileModel';

type RemoteLabels = {
  image: string | null;
  transcription: string | null;
  voice: string | null;
  imageReady: boolean | null;
  transcriptionReady: boolean | null;
  voiceReady: boolean | null;
};

/** Human labels for the active server's selected media models. */
export function useActiveRemoteModelLabels(): RemoteLabels {
  const imageSnapshot = useActiveMobileModel('image');
  const transcriptionSnapshot = useActiveMobileModel('transcription');
  const voiceSnapshot = useActiveMobileModel('voice');
  const image = imageSnapshot.model;
  const transcription = transcriptionSnapshot.model;
  const voice = voiceSnapshot.model;
  const remoteName = (model: typeof image) =>
    model?.source === 'remote' ? model.name : null;
  return {
    image: remoteName(image),
    transcription: remoteName(transcription),
    voice: remoteName(voice),
    imageReady: image?.source === 'remote' ? imageSnapshot.ready : null,
    transcriptionReady:
      transcription?.source === 'remote' ? transcriptionSnapshot.ready : null,
    voiceReady: voice?.source === 'remote' ? voiceSnapshot.ready : null,
  };
}
