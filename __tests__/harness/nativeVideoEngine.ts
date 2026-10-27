/**
 * The phone's own video engine and film composer, at the native-module boundary.
 *
 * VideoGenerationModule (android/app/src/main/java/ai/offgridmobile/video/VideoGenerationModule.kt):
 * `generate(input)` emits `VideoGenerationProgress` { stage, step, total, backend? } — preparing,
 * conditioning (with the backend), each sampling step, decoding, encoding — writes the MP4 at
 * `input.outputPath` and resolves { path }. `cancel()` stops it: the promise rejects with code
 * VIDEO_CANCELLED and the file is discarded. A second generate while one runs rejects VIDEO_BUSY.
 * `getVideoStatus(path)` reports the last job; getConstants() says it can start from a picture.
 *
 * OffgridFilm (pro/native/film/android/.../FilmModule.kt): `compose(input)` writes the film at
 * `input.outputPath` and resolves { path, durationSeconds }; `lastFrame(video, out)` writes a PNG and
 * resolves its path; the session calls keep a long render alive and resolve null.
 *
 * `hold()` parks the next clip after its first sampling step, so a test can see it in flight;
 * `release()` lets it finish. `failNext(message)` makes the next clip fail as the engine reports it.
 */
import type { NativeBoundary } from './nativeBoundary';

export interface NativeVideoEngine {
  /** Every generate input the engine received. */
  generations: Array<Record<string, unknown>>;
  /** Every film the composer joined. */
  films: Array<{ clips: Array<{ path: string; caption?: string }>; outputPath: string }>;
  hold: () => void;
  release: () => void;
  failNext: (message: string) => void;
  /** From now on the engine also hands back its first decoded frame, as sd.cpp's preview callback does. */
  showPreviews: () => void;
}

/** Install both modules. Call from launchApp's `beforeApp`, before anything requires Pro. */
export function installNativeVideoEngine(boundary: NativeBoundary): NativeVideoEngine {
  const fs = boundary.fs!;
  const events = boundary.litertEvents;
  const RN = require('react-native');
  let holdNext = false;
  let parked: (() => void) | null = null;
  let failure: string | null = null;
  let previews = false;
  let running: { reject: (error: Error) => void; output: string } | null = null;
  let status: Record<string, unknown> | null = null;
  const engine: NativeVideoEngine = {
    generations: [],
    films: [],
    hold: () => {
      holdNext = true;
    },
    release: () => {
      holdNext = false;
      parked?.();
      parked = null;
    },
    failNext: message => {
      failure = message;
    },
    showPreviews: () => {
      previews = true;
    },
  };
  const coded = (code: string, message: string) => Object.assign(new Error(message), { code });
  const progress = (stage: string, step: number, total: number, backend?: string) => {
    status = { ...status, stage, step, total, ...(backend ? { backend } : {}) };
    events.emit('VideoGenerationProgress', { stage, step, total, ...(backend ? { backend } : {}) });
  };

  RN.NativeModules.VideoGenerationModule = {
    getConstants: () => ({ supportsInitImage: true, supportsUpscale: false }),
    addListener: () => undefined,
    removeListeners: () => undefined,
    getVideoStatus: async (outputPath: string) => (status && status.path === outputPath ? status : null),
    cancel: async () => {
      parked?.();
      parked = null;
      running?.reject(coded('VIDEO_CANCELLED', 'Video generation stopped.'));
      return null;
    },
    generate: (input: Record<string, unknown>) =>
      new Promise<{ path: string }>((resolve, reject) => {
        if (running) {
          reject(coded('VIDEO_BUSY', 'Video generation is already running.'));
          return;
        }
        engine.generations.push(input);
        const output = String(input.outputPath);
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          running = null;
          if (error) {
            status = { ...status, phase: 'failed', code: (error as Error & { code?: string }).code, error: error.message };
            reject(error);
          } else {
            status = { ...status, phase: 'succeeded' };
            resolve({ path: output });
          }
        };
        running = { reject: error => finish(error), output };
        status = { path: output, phase: 'running', stage: 'preparing', step: 0, total: 0 };
        const steps = Number(input.steps) || 4;
        (async () => {
          progress('preparing', 0, steps);
          progress('conditioning', 0, 0, 'cpu');
          progress('generating', 0, steps);
          progress('generating', 1, steps);
          if (previews) {
            // The native preview: a PNG beside the clip, announced on the encoding stage (VideoGenerationModule.preview).
            const preview = { path: `${output}.preview.png`, width: Number(input.width) || 320, height: Number(input.height) || 192 };
            fs.seedFile(preview.path, 2048);
            status = { ...status, stage: 'encoding', step: 0, total: 0, preview };
            events.emit('VideoGenerationProgress', { stage: 'encoding', step: 0, total: 0, preview });
          }
          if (holdNext) {
            holdNext = false;
            await new Promise<void>(go => {
              parked = go;
            });
          }
          if (settled) return;
          if (failure) {
            const message = failure;
            failure = null;
            finish(coded('VIDEO_FAILED', message));
            return;
          }
          for (let step = 2; step <= steps; step += 1) progress('generating', step, steps);
          progress('decoding', 1, 1);
          progress('encoding', 0, 0);
          fs.seedFile(output, 64 * 1024);
          finish();
        })().catch(error => finish(error as Error));
      }),
  };

  RN.NativeModules.OffgridFilm = {
    addListener: () => undefined,
    removeListeners: () => undefined,
    beginSession: async () => null,
    updateSession: async () => null,
    endSession: async () => null,
    cancel: async () => null,
    notifyReady: async () => null,
    askToNotify: async () => true,
    compose: async (input: { clips: Array<{ path: string; caption?: string }>; outputPath: string; crossfadeSeconds: number }) => {
      engine.films.push(input);
      fs.seedFile(input.outputPath, 256 * 1024);
      return { path: input.outputPath, durationSeconds: input.clips.length * 5 - (input.clips.length - 1) * input.crossfadeSeconds };
    },
    lastFrame: async (_videoPath: string, outputPath: string) => {
      fs.seedFile(outputPath, 4096);
      return outputPath;
    },
  };
  return engine;
}

/**
 * The phone's background downloads, finished on demand. The native module moves a finished file to
 * where the app asked (moveCompletedDownload); the stand-in in nativeBoundary only answers the path,
 * so this writes the file there at the size the download reported, as the device does.
 */
export interface PhoneDownloads {
  /** Finish every file downloading now, one DownloadComplete each. Returns how many finished. */
  finishRunning: () => Promise<number>;
}

export function phoneDownloads(boundary: NativeBoundary, act: (work: () => Promise<void>) => Promise<void>): PhoneDownloads {
  const download = boundary.download!;
  const fs = boundary.fs!;
  const sizes = new Map<string, number>();
  const finished = new Set<string>();
  const start = download.module.startDownload.getMockImplementation()!;
  download.module.startDownload.mockImplementation(async (params: { totalBytes?: number }) => {
    const row = await start(params);
    sizes.set(row.downloadId, Number(params.totalBytes) || 1024);
    return row;
  });
  download.module.moveCompletedDownload.mockImplementation(async (id: string, target: string) => {
    fs.seedFile(target, sizes.get(id) ?? 1024);
    return target;
  });
  return {
    finishRunning: async () => {
      const rows = download.active().filter(row => row.status === 'running' && !finished.has(row.downloadId));
      for (const row of rows) {
        finished.add(row.downloadId);
        const total = sizes.get(row.downloadId) ?? 1024;
        await act(async () => {
          download.events.emit('DownloadComplete', {
            downloadId: row.downloadId,
            fileName: row.fileName,
            modelId: row.modelId,
            bytesDownloaded: total,
            totalBytes: total,
            status: 'completed',
            localUri: `/downloads/${row.fileName}`,
          });
          await new Promise(resolve => setTimeout(resolve, 0));
        });
      }
      return rows.length;
    },
  };
}
