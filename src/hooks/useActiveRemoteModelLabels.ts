import { useActiveMobileModel } from './useActiveMobileModel';

type RemoteLabels = {
  image: string | null;
  transcription: string | null;
  voice: string | null;
};

/** Human labels for the active server's selected media models. */
export function useActiveRemoteModelLabels(): RemoteLabels {
  const image = useActiveMobileModel('image').model;
  const transcription = useActiveMobileModel('transcription').model;
  const voice = useActiveMobileModel('voice').model;
  const remoteName = (model: typeof image) =>
    model?.source === 'remote' ? model.name : null;
  return {
    image: remoteName(image),
    transcription: remoteName(transcription),
    voice: remoteName(voice),
  };
}
