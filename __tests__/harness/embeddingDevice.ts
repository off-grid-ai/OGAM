/**
 * embeddingDevice — launch the app's embedding stack on a faked device, for tests of code that embeds text
 * (the tool router, search). Everything we own runs: the real embeddingService (copies the bundled MiniLM
 * .gguf out of the app bundle, loads it through the residency manager's load lock, validates vectors), the
 * documents store it reads the chosen model from, AsyncStorage-backed caches above it.
 *
 * Faked, because it is the device: llama.rn's embedding context (via installNativeBoundary({ llama: true })
 * and installDocumentEngine), react-native-fs (memfs), op-sqlite (real in-memory SQLite).
 *
 * `embedded` is the list of texts the NATIVE embedding call received, in order — what the device was asked
 * to compute. A cache above it shows up as texts that are NOT in this list.
 *
 * Calling launchEmbeddingDevice() again models a relaunch: a fresh module graph (every in-memory cache gone)
 * with AsyncStorage (jest.setup's in-memory store, which lives outside the module graph) kept, as on the phone.
 */
import { installNativeBoundary, GB } from './nativeBoundary';
import { installDocumentEngine } from './documentEngine';

export interface EmbeddingDevice {
  /** Texts the native embedding context was asked to embed, since launch. */
  embedded: string[];
}

export function launchEmbeddingDevice(options: { topics?: string[][] } = {}): EmbeddingDevice {
  // iOS: the bundled model is copied out of the app bundle, which installDocumentEngine places on disk.
  const boundary = installNativeBoundary({
    llama: true,
    fs: true,
    ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 4 * GB },
  });
  installDocumentEngine(boundary.fs!, { llama: boundary.llama!.module, topics: options.topics });
  const device: EmbeddingDevice = { embedded: [] };
  const initLlama = boundary.llama!.module.initLlama;
  const open = initLlama.getMockImplementation()!;
  initLlama.mockImplementation(async (params: { embedding?: boolean }) => {
    const context = await open(params);
    if (!params?.embedding) return context;
    const embed = context.embedding as (text: string) => Promise<{ embedding: number[] }>;
    return {
      ...context,
      embedding: (text: string) => {
        device.embedded.push(text);
        return embed(text);
      },
    };
  });
  return device;
}
