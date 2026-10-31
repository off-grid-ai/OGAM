/**
 * Remote media runtime, on the real stack: servers and their keys are saved through the real
 * remoteServerManager into the device Keychain (a stateful fake of the native module), and requests go to a
 * fake media server at the fetch boundary. The written speech file lands in an in-memory file system.
 */
jest.mock('react-native-keychain', () =>
  require('../../harness/keyedRemoteServer').keychainModule(),
);
jest.mock('react-native-fs', () => {
  const { defaultNativeFileSystemBoundary: boundary } = require('../../harness/nativeFileSystem');
  return { __esModule: true, default: boundary.module, ...boundary.module };
});

import { Buffer } from 'buffer';
import RNFS from 'react-native-fs';
import { remoteMediaRuntime } from '../../../src/services/remoteMediaRuntime';
import { remoteServerManager } from '../../../src/services/remoteServerManager';
import { whisperService } from '../../../src/services/whisperService';
import {
  activeRemoteVoiceServer,
  synthesizeRemoteVoiceFile,
} from '../../../src/services/remoteVoicePlayback';
import { remoteServerCapabilities, type RemoteServer } from '../../../src/types';
import { resetKeychain } from '../../harness/keyedRemoteServer';
import { defaultNativeFileSystemBoundary } from '../../harness/nativeFileSystem';
import {
  installRemoteMediaServer,
  type RemoteMediaServerHandle,
} from '../../harness/remoteMediaServer';

const LAN = 'http://192.168.1.30:7878';
const mediaModels = {
  image: 'flux-schnell',
  transcription: 'whisper-large-v3',
  voice: 'kokoro',
};

/** Pair a server the way the app does: the record in the store, the key in the Keychain. */
function addServer(input: {
  name?: string;
  endpoint: string;
  apiKey?: string;
  mediaModels?: RemoteServer['mediaModels'];
}): Promise<RemoteServer> {
  return remoteServerManager.addServer({
    name: input.name ?? 'Study Mac',
    endpoint: input.endpoint,
    providerType: 'openai-compatible',
    mediaModels: input.mediaModels ?? mediaModels,
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
  });
}

describe('remoteMediaRuntime', () => {
  let server: RemoteMediaServerHandle | null = null;

  beforeEach(async () => {
    resetKeychain();
    defaultNativeFileSystemBoundary.reset();
    await remoteServerManager.clearAllServers();
  });

  afterEach(() => {
    server?.restore();
    server = null;
  });

  it('derives media capabilities from the server model IDs', () => {
    expect(remoteServerCapabilities({ mediaModels })).toEqual({
      imageGeneration: true,
      transcription: true,
      videoGeneration: false,
      voice: true,
    });
    expect(
      remoteServerCapabilities({ mediaModels: { video: 'wan2.1' } }).videoGeneration,
    ).toBe(true);
    expect(remoteServerCapabilities({ mediaModels: { image: '   ' } })).toEqual({
      imageGeneration: false,
      transcription: false,
      videoGeneration: false,
      voice: false,
    });
  });

  it('sends the saved key to a private-LAN HTTP gateway and rejects redirects', async () => {
    server = installRemoteMediaServer({ origin: LAN, apiKey: 'device-secret', image: 'image-bytes' });
    const paired = await addServer({ endpoint: `${LAN}/`, apiKey: 'device-secret' });

    await expect(
      remoteMediaRuntime.generateImage(paired, { prompt: 'A quiet desk' }),
    ).resolves.toEqual({ base64: 'image-bytes', url: undefined });

    expect(server.requests).toHaveLength(1);
    const [sent] = server.requests;
    expect(sent.path).toBe('/v1/images/generations');
    expect(sent.headers['Content-Type']).toBe('application/json');
    expect(sent.headers.Authorization).toBe('Bearer device-secret');
    expect(sent.redirect).toBe('error');
    expect(sent.body).toMatchObject({ model: 'flux-schnell', prompt: 'A quiet desk' });
    // The key lives only in the Keychain, never on the saved server record.
    expect(paired).not.toHaveProperty('apiKey');
    expect(remoteServerManager.getServer(paired.id)).not.toHaveProperty('apiKey');
  });

  it('sends a stored credential to an HTTPS endpoint', async () => {
    const origin = 'https://desktop.example.test';
    server = installRemoteMediaServer({ origin, apiKey: 'device-secret', image: 'image-bytes' });
    const paired = await addServer({ endpoint: origin, apiKey: 'device-secret' });

    await expect(
      remoteMediaRuntime.generateImage(paired, { prompt: 'A quiet desk' }),
    ).resolves.toEqual({ base64: 'image-bytes', url: undefined });
    expect(server.requests[0].headers.Authorization).toBe('Bearer device-secret');
    expect(server.requests[0].redirect).toBe('error');
  });

  it('uses the transcription endpoint and reports an empty server response', async () => {
    server = installRemoteMediaServer({ origin: LAN });
    const paired = await addServer({ endpoint: `${LAN}/` });

    await expect(
      remoteMediaRuntime.transcribe(paired, { fileUri: 'file:///recording.wav' }),
    ).rejects.toThrow('Remote server returned no transcript');
    expect(server.requests.map(r => `${r.method} ${r.path}`)).toEqual([
      'POST /v1/audio/transcriptions',
    ]);
  });

  it('routes file transcription through the active server without a local Whisper model', async () => {
    server = installRemoteMediaServer({ origin: LAN, transcript: 'Private meeting notes' });
    const paired = await addServer({
      endpoint: `${LAN}/`,
      mediaModels: { transcription: 'whisper-large-v3' },
    });
    await remoteServerManager.setActiveRemoteMediaModel(
      paired.id,
      'transcription',
      'whisper-large-v3',
    );

    await expect(
      whisperService.transcribeFile('file:///recording.wav'),
    ).resolves.toBe('Private meeting notes');
    expect(server.requests.map(r => r.path)).toEqual(['/v1/audio/transcriptions']);
  });

  it('cancels an in-flight voice request through AbortSignal', async () => {
    server = installRemoteMediaServer({ origin: LAN, hang: true });
    const paired = await addServer({ endpoint: `${LAN}/` });
    const controller = new AbortController();
    const pending = remoteMediaRuntime.synthesizeVoice(
      paired,
      { text: 'Your summary is ready.' },
      { signal: controller.signal },
    );
    controller.abort();

    await expect(pending).rejects.toThrow('Remote request cancelled');
  });

  it('writes remote speech into the file-backed playback seam for the active Desktop', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    server = installRemoteMediaServer({
      origin: LAN,
      speech: { bytes, contentType: 'audio/mpeg' },
    });
    const paired = await addServer({
      name: 'Studio Mac',
      endpoint: `${LAN}/`,
      mediaModels: { voice: 'kokoro' },
    });
    expect(activeRemoteVoiceServer()).toBeNull();
    await remoteServerManager.setActiveRemoteMediaModel(paired.id, 'voice', 'kokoro');

    const active = activeRemoteVoiceServer();
    expect(active?.name).toBe('Studio Mac');
    const path = '/mock/caches/remote_voice/message_1.mp3';
    expect(await RNFS.exists(path)).toBe(false);
    await expect(
      synthesizeRemoteVoiceFile({
        server: active!,
        text: 'Your summary is ready.',
        messageId: 'message:1',
        voice: 'hf_alpha',
        signal: new AbortController().signal,
      }),
    ).resolves.toBe(path);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].path).toBe('/v1/audio/speech');
    expect(server.requests[0].body).toEqual({
      model: 'kokoro',
      input: 'Your summary is ready.',
      voice: 'hf_alpha',
    });
    expect(await RNFS.readFile(path, 'base64')).toBe(Buffer.from(bytes).toString('base64'));
  });
});
