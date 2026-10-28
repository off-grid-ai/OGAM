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
 *
 * The same module draws sd.cpp images (VideoGenerationModule.mm loadImageModel / generateImage): one
 * engine, so while an image is drawn a clip is refused (VIDEO_BUSY) and while a clip runs an image is
 * refused (IMAGE_BUSY). `holdImages()` parks the images being drawn until `releaseImages()`.
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
  /** Every sd.cpp image the engine was asked to draw. */
  images: Array<Record<string, unknown>>;
  holdImages: () => void;
  releaseImages: () => void;
}

/** What the native side keeps across a JS reload: the job it is running, and its status. */
interface EngineCore {
  fs: NonNullable<NativeBoundary['fs']>;
  events: NativeBoundary['litertEvents'];
  holdNext: boolean;
  parked: (() => void) | null;
  failure: string | null;
  previews: boolean;
  running: { reject: (error: Error) => void; output: string } | null;
  status: Record<string, unknown> | null;
  /** The JS context that asked for the running job is still there to hear how it ends. */
  jsAttached: boolean;
  imagePath: string | null;
  holdImages: boolean;
  parkedImages: Array<() => void>;
}

const cores = new WeakMap<NativeVideoEngine, EngineCore>();

/**
 * Install both modules. Call from launchApp's `beforeApp`, before anything requires Pro.
 *
 * `carryOver`: the app's JS was started again while the native side kept running (Android keeps the
 * video worker alive under its foreground service). The engine keeps its job and status; the old JS
 * context is gone, so the old promise is never settled, and the new launch finds the job by status.
 */
export function installNativeVideoEngine(boundary: NativeBoundary, carryOver?: NativeVideoEngine): NativeVideoEngine {
  const RN = require('react-native');
  const previous = carryOver ? cores.get(carryOver) : undefined;
  const core: EngineCore = previous ?? {
    fs: boundary.fs!,
    events: boundary.litertEvents,
    holdNext: false,
    parked: null,
    failure: null,
    previews: false,
    running: null,
    status: null,
    jsAttached: true,
    imagePath: null,
    holdImages: false,
    parkedImages: [],
  };
  core.fs = boundary.fs!;
  core.events = boundary.litertEvents;
  if (previous) core.jsAttached = false;
  const engine: NativeVideoEngine = {
    generations: carryOver?.generations ?? [],
    films: carryOver?.films ?? [],
    hold: () => {
      core.holdNext = true;
    },
    release: () => {
      core.holdNext = false;
      core.parked?.();
      core.parked = null;
    },
    failNext: message => {
      core.failure = message;
    },
    showPreviews: () => {
      core.previews = true;
    },
    images: carryOver?.images ?? [],
    holdImages: () => {
      core.holdImages = true;
    },
    releaseImages: () => {
      core.holdImages = false;
      for (const go of core.parkedImages.splice(0)) go();
    },
  };
  cores.set(engine, core);
  const coded = (code: string, message: string) => Object.assign(new Error(message), { code });
  const progress = (stage: string, step: number, total: number, backend?: string) => {
    core.status = { ...core.status, stage, step, total, ...(backend ? { backend } : {}) };
    core.events.emit('VideoGenerationProgress', { stage, step, total, ...(backend ? { backend } : {}) });
  };

  RN.NativeModules.VideoGenerationModule = {
    getConstants: () => ({ supportsInitImage: true, supportsUpscale: false }),
    addListener: () => undefined,
    removeListeners: () => undefined,
    getVideoStatus: async (outputPath: string) => (core.status && core.status.path === outputPath ? core.status : null),
    getLoadedImagePath: async () => core.imagePath,
    loadImageModel: async (input: { modelPath: string }) => {
      if (core.running) throw coded('IMAGE_BUSY', 'Image or video generation is running.');
      core.imagePath = input.modelPath;
      return true;
    },
    unloadImageModel: async () => {
      core.imagePath = null;
      return true;
    },
    generateImage: (input: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        if (core.running) {
          reject(coded('IMAGE_BUSY', 'Image or video generation is running.'));
          return;
        }
        engine.images.push(input);
        const output = String(input.outputPath);
        core.running = {
          reject: error => {
            core.running = null;
            reject(error);
          },
          output,
        };
        const draw = () => {
          if (core.running?.output !== output) return;
          core.running = null;
          core.fs.seedFile(output, 4096);
          resolve({ id: input.id, imagePath: output, width: input.width, height: input.height, seed: input.seed });
        };
        if (core.holdImages) core.parkedImages.push(draw);
        else setTimeout(draw, 0);
      }),
    cancel: async () => {
      core.parked?.();
      core.parked = null;
      core.running?.reject(coded('VIDEO_CANCELLED', 'Video generation stopped.'));
      return null;
    },
    generate: (input: Record<string, unknown>) =>
      new Promise<{ path: string }>((resolve, reject) => {
        if (core.running) {
          reject(coded('VIDEO_BUSY', 'Video generation is already running.'));
          return;
        }
        engine.generations.push(input);
        const output = String(input.outputPath);
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          core.running = null;
          const heard = core.jsAttached;
          if (error) {
            core.status = { ...core.status, phase: 'failed', code: (error as Error & { code?: string }).code, error: error.message };
            if (heard) reject(error);
          } else {
            core.status = { ...core.status, phase: 'succeeded' };
            if (heard) resolve({ path: output });
          }
        };
        core.jsAttached = true;
        core.running = { reject: error => finish(error), output };
        core.status = { path: output, phase: 'running', stage: 'preparing', step: 0, total: 0 };
        const steps = Number(input.steps) || 4;
        (async () => {
          progress('preparing', 0, steps);
          progress('conditioning', 0, 0, 'cpu');
          progress('generating', 0, steps);
          progress('generating', 1, steps);
          if (core.previews) {
            // The native preview: a PNG beside the clip, announced on the encoding stage (VideoGenerationModule.preview).
            const preview = { path: `${output}.preview.png`, width: Number(input.width) || 320, height: Number(input.height) || 192 };
            core.fs.seedFile(preview.path, 2048);
            core.status = { ...core.status, stage: 'encoding', step: 0, total: 0, preview };
            core.events.emit('VideoGenerationProgress', { stage: 'encoding', step: 0, total: 0, preview });
          }
          if (core.holdNext) {
            core.holdNext = false;
            await new Promise<void>(go => {
              core.parked = go;
            });
          }
          if (settled) return;
          if (core.failure) {
            const message = core.failure;
            core.failure = null;
            finish(coded('VIDEO_FAILED', message));
            return;
          }
          for (let step = 2; step <= steps; step += 1) progress('generating', step, steps);
          progress('decoding', 1, 1);
          progress('encoding', 0, 0);
          // The clip is written where the app asked, on the disk of the launch that is running now.
          core.fs.seedFile(output, 64 * 1024);
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
      // AVFoundation finds no video track in a file that is not there (FilmModule.swift makeExport).
      for (const clip of input.clips)
        if (!(await core.fs.exists(clip.path))) throw coded('FILM_FAILED', 'A clip has no video.');
      engine.films.push(input);
      core.fs.seedFile(input.outputPath, 256 * 1024);
      return { path: input.outputPath, durationSeconds: input.clips.length * 5 - (input.clips.length - 1) * input.crossfadeSeconds };
    },
    lastFrame: async (_videoPath: string, outputPath: string) => {
      core.fs.seedFile(outputPath, 4096);
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
  // A download started before a restart (seeded, as Android keeps it) is sized by its own native row.
  const sizeOf = (id: string) =>
    sizes.get(id) ?? (Number(download.active().find(row => row.downloadId === id)?.totalBytes) || 1024);
  download.module.moveCompletedDownload.mockImplementation(async (id: string, target: string) => {
    fs.seedFile(target, sizeOf(id));
    return target;
  });
  return {
    finishRunning: async () => {
      const rows = download.active().filter(row => row.status === 'running' && !finished.has(row.downloadId));
      for (const row of rows) {
        finished.add(row.downloadId);
        const total = sizeOf(row.downloadId);
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
