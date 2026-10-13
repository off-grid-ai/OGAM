import { remoteMediaRuntime } from '../../../src/services/remoteMediaRuntime';
import * as Keychain from 'react-native-keychain';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { whisperService } from '../../../src/services/whisperService';
import RNFS from 'react-native-fs';
import {
  activeRemoteVoiceServer,
  synthesizeRemoteVoiceFile,
} from '../../../src/services/remoteVoicePlayback';
import {
  remoteServerCapabilities,
  type RemoteServer,
} from '../../../src/types';

const server: RemoteServer = {
  id: 'desktop-study',
  name: 'Study Mac',
  endpoint: 'http://192.168.1.30:7878/',
  providerType: 'openai-compatible',
  createdAt: '2026-08-29T00:00:00.000Z',
  mediaModels: {
    image: 'flux-schnell',
    transcription: 'whisper-large-v3',
    voice: 'kokoro',
  },
};

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

describe('remoteMediaRuntime', () => {
  const originalFetch = global.fetch;

  beforeEach(async () => {
    useRemoteServerStore.getState().clearAllServers();
    jest.spyOn(Keychain, 'getGenericPassword').mockResolvedValue({
      service: `ai.offgridmobile.servers.${server.id}`,
      storage: 'AES_GCM',
      username: `server_${server.id}`,
      password: 'device-secret',
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('derives media capabilities from the server model IDs', () => {
    expect(remoteServerCapabilities(server)).toEqual({
      imageGeneration: true,
      transcription: true,
      videoGeneration: false,
      voice: true,
    });
    expect(
      remoteServerCapabilities({ mediaModels: { video: 'wan2.1' } }).videoGeneration,
    ).toBe(true);
    expect(remoteServerCapabilities({ mediaModels: { image: '   ' } })).toEqual(
      {
      imageGeneration: false,
      transcription: false,
      videoGeneration: false,
      voice: false,
      },
    );
  });

  it('keeps private-LAN HTTP unauthenticated and rejects redirects', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    global.fetch = jest.fn(async (url, init) => {
      calls.push([url, init]);
      return jsonResponse({ data: [{ b64_json: 'image-bytes' }] });
    }) as typeof fetch;

    await expect(
      remoteMediaRuntime.generateImage(server, { prompt: 'A quiet desk' }),
    ).resolves.toEqual({ base64: 'image-bytes', url: undefined });

    expect(calls[0]?.[0]).toBe(
      'http://192.168.1.30:7878/v1/images/generations',
    );
    expect(calls[0]?.[1]?.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
    expect(calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
    expect(calls[0]?.[1]?.redirect).toBe('error');
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toMatchObject({
      model: 'flux-schnell',
      prompt: 'A quiet desk',
    });
    expect(server).not.toHaveProperty('apiKey');
  });

  it('sends a stored credential only to an HTTPS endpoint', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    global.fetch = jest.fn(async (url, init) => {
      calls.push([url, init]);
      return jsonResponse({ data: [{ b64_json: 'image-bytes' }] });
    }) as typeof fetch;
    await remoteMediaRuntime.generateImage(
      { ...server, endpoint: 'https://desktop.example.test' },
      { prompt: 'A quiet desk' },
    );
    expect(calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer device-secret',
    });
    expect(calls[0]?.[1]?.redirect).toBe('error');
  });

  it('uses the transcription endpoint and reports an empty server response', async () => {
    global.fetch = jest.fn(async () => jsonResponse({})) as typeof fetch;

    await expect(
      remoteMediaRuntime.transcribe(server, {
        fileUri: 'file:///recording.wav',
      }),
    ).rejects.toThrow('Remote server returned no transcript');
  });

  it('routes file transcription through the active server without a local Whisper model', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ text: 'Private meeting notes' }),
    ) as typeof fetch;
    const store = useRemoteServerStore.getState();
    const serverId = store.addServer({
      name: server.name,
      endpoint: server.endpoint,
      providerType: server.providerType,
      mediaModels: { transcription: 'whisper-large-v3' },
    });
    store.setActiveRemoteMediaServerId('transcription', serverId);

    await expect(
      whisperService.transcribeFile('file:///recording.wav'),
    ).resolves.toBe('Private meeting notes');
  });

  it('cancels an in-flight voice request through AbortSignal', async () => {
    global.fetch = jest.fn(() => new Promise(() => undefined)) as typeof fetch;
    const controller = new AbortController();
    const pending = remoteMediaRuntime.synthesizeVoice(
      server,
      { text: 'Your summary is ready.' },
      { signal: controller.signal },
    );
    controller.abort();

    await expect(pending).rejects.toThrow('Remote request cancelled');
  });

  it('writes remote speech into the file-backed playback seam for the active Desktop', async () => {
    const audio = Uint8Array.from([1, 2, 3, 4]).buffer;
    global.fetch = jest.fn(
      async () =>
        ({
      ...jsonResponse({}, 200),
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => audio,
        } as unknown as Response),
    ) as typeof fetch;
    const store = useRemoteServerStore.getState();
    const id = store.addServer({
      name: 'Studio Mac',
      endpoint: server.endpoint,
      providerType: server.providerType,
      mediaModels: { voice: 'kokoro' },
    });
    store.setActiveRemoteMediaServerId('voice', id);

    const active = activeRemoteVoiceServer();
    expect(active?.name).toBe('Studio Mac');
    await expect(
      synthesizeRemoteVoiceFile({
        server: active!,
        text: 'Your summary is ready.',
        messageId: 'message:1',
        voice: 'hf_alpha',
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('/mock/caches/remote_voice/message_1.mp3');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.1.30:7878/v1/audio/speech',
      expect.objectContaining({
        body: JSON.stringify({
          model: 'kokoro',
          input: 'Your summary is ready.',
          voice: 'hf_alpha',
        }),
      }),
    );
    expect(RNFS.writeFile).toHaveBeenCalledWith(
      '/mock/caches/remote_voice/message_1.mp3',
      Buffer.from(audio).toString('base64'),
      'base64',
    );
  });
});
