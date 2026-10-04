import { activeMobileRoute } from '../../modelServices/mobileLLMService';
import RNFS from 'react-native-fs';
import type { RemoteServer } from '../../../types';
import { useRemoteServerStore } from '../../../stores/remoteServerStore';
import { remoteMediaRuntime } from './mediaRuntime';

let previousPath: string | null = null;

function arrayBufferToBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCodePoint(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return globalThis.btoa(binary);
}

export function activeRemoteVoiceServer(): RemoteServer | null {
  // The remote voice server is the voice route's server; the route is the one selection fact.
  const serverId = activeMobileRoute('voice').model?.serverId;
  const server = serverId
    ? useRemoteServerStore.getState().servers.find(item => item.id === serverId) ?? null
    : null;
  return server?.selections?.voice ? server : null;
}

/** Synthesize one remote voice clip into the file-backed playback seam. */
export async function synthesizeRemoteVoiceFile(input: {
  server: RemoteServer;
  model?: string;
  text: string;
  messageId: string;
  voice?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { server, model, text, messageId, voice, signal } = input;
  const result = await remoteMediaRuntime.synthesizeVoice(
    server,
    { text, voice, model },
    { signal },
  );
  if (result.audio.byteLength === 0)
    throw new Error('Remote server returned no voice audio');
  const directory = `${RNFS.CachesDirectoryPath}/remote_voice`;
  await RNFS.mkdir(directory);
  const extension = result.contentType.includes('wav') ? 'wav' : 'mp3';
  const safeId = messageId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `${directory}/${safeId}.${extension}`;
  await RNFS.writeFile(path, arrayBufferToBase64(result.audio), 'base64');
  if (signal?.aborted) {
    await RNFS.unlink(path).catch(() => undefined);
    throw new Error('Remote request cancelled');
  }
  if (previousPath && previousPath !== path) {
    await RNFS.unlink(previousPath).catch(() => undefined);
  }
  previousPath = path;
  return path;
}
