/* eslint-disable max-lines -- 655 lines. transcribeFile complexity is genuinely
   fixed (buildTranscribeOpts) and the model catalogue is split into whisperModels.ts;
   getting under 500 needs moving download/model-management into its own module,
   which touches ~11 call sites across core + pro. Deferred as a dedicated task -
   see docs/plans/ci-lint-test-progress.md section 4. */
import { initWhisper, WhisperContext, RealtimeTranscribeEvent } from 'whisper.rn';
import * as WhisperRn from 'whisper.rn';
import { Platform, PermissionsAndroid } from 'react-native';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import logger from '../utils/logger';
import { WHISPER_MODELS, cleanTranscription } from './whisperModels';
import { audioSessionManager } from './audioSessionManager';
import { audioRecorderService } from './audioRecorderService';
import * as whisperModelFiles from './whisperModelFiles';

// Re-exported so existing consumers keep importing them from whisperService.
export { WHISPER_MODELS, cleanTranscription };

// Pipe whisper.cpp's native logs (system_info with the real n_threads, model
// load info, encode/decode timings) into our logger so they show in both the
// JS debug-log screen and logcat. Wired once, lazily. Accessed via a cast
// because the local whisper.rn type shim doesn't declare these (they exist at
// runtime in whisper.rn >= 0.5).
let nativeWhisperLogWired = false;
function wireNativeWhisperLog(): void {
  if (nativeWhisperLogWired) return;
  nativeWhisperLogWired = true;
  const w = WhisperRn as unknown as {
    toggleNativeLog?: (enabled: boolean) => void;
    addNativeLogListener?: (l: (level: string, text: string) => void) => void;
  };
  try {
    w.toggleNativeLog?.(true);
    w.addNativeLogListener?.((level: string, text: string) => {
      const msg = text.trim();
      if (msg) logger.log(`[whisper.cpp:${level}] ${msg}`);
    });
    logger.log('[Whisper] native logging enabled');
  } catch (e) {
    logger.warn(`[Whisper] could not enable native logging: ${String(e)}`);
  }
}
import { backgroundDownloadService } from './backgroundDownloadService';
import { useDownloadStore } from '../stores/downloadStore';
import { makeModelKey } from '../utils/modelKey';

export interface TranscriptionResult {
  text: string;
  isCapturing: boolean;
  processTime: number;
  recordingTime: number;
}
export type TranscriptionCallback = (result: TranscriptionResult) => void;

/** Options for {@link WhisperService.transcribeFile}. */
interface TranscribeFileOptions {
  language?: string;
  onProgress?: (progress: number) => void;
  // Fires every time Whisper finishes decoding a chunk (~30s of audio). `text`
  // is the cumulative transcript so far, ready to drop straight into the UI.
  onPartial?: (text: string) => void;
  maxThreads?: number;
  nProcessors?: number;
  // Transcribe only a window of the file (ms). Used for chunked / resumable
  // transcription of long recordings.
  offset?: number;
  duration?: number;
  // Receives the final segments with whisper.cpp timestamps. t0/t1 are in
  // centiseconds (10ms units) relative to the processed window.
  onSegments?: (segments: { text: string; t0: number; t1: number }[]) => void;
  // Enable tinydiarize (tdrz): whisper marks speaker-turn boundaries with a
  // [SPEAKER_TURN] token. Requires a tdrz model (ggml-small.en-tdrz.bin);
  // other models silently ignore it. English only.
  diarize?: boolean;
  // Optional vocabulary hint (whisper.cpp initial prompt): a short list of
  // proper nouns / jargon (e.g. "Off Grid, Locket, Kokoro") that biases whisper
  // toward spelling them correctly. Kept short - it competes with audio context.
  prompt?: string;
}

/**
 * Thrown when a file transcription is requested while one is already running on
 * the single shared context. Lets callers distinguish "busy" from a real failure
 * (and avoids the old behaviour of silently orphaning the first job's cancel handle).
 */
export class WhisperBusyError extends Error {
  constructor(message = 'A transcription is already in progress') {
    super(message);
    this.name = 'WhisperBusyError';
  }
}

class WhisperService {
  private context: WhisperContext | null = null;
  private currentModelPath: string | null = null;
  private isTranscribing: boolean = false;
  private stopFn: (() => void) | null = null;
  private isReleasingContext: boolean = false;
  private contextReleasePromise: Promise<void> = Promise.resolve();
  private transcriptionFullyStopped: Promise<void> = Promise.resolve();
  private activeDownloadId: string | null = null;
  // The model id the in-flight download belongs to. Paired with activeDownloadId so
  // deleteModel only cancels the download when it is THIS model's — deleting an
  // unrelated (already-downloaded) model must never abort a different in-flight one.
  private activeDownloadModelId: string | null = null;
  private fileTranscribeStop: (() => void | Promise<void>) | null = null;
  // True only while the REALTIME fallback recorder (started by startRealtimeTranscription for the
  // B26/B28 safety net) is running. forceReset uses this to cancel OUR recorder without ever
  // touching a recording started elsewhere — Voice.ts's direct/file-path modes share the same
  // audioRecorderService singleton, so a blunt isCurrentlyRecording() check could kill theirs.
  private fallbackRecorderActive = false;
  // Models whose CoreML encoder we've already tried to backfill this session,
  // so a missing/404 encoder isn't re-fetched on every load.
  private coreMLBackfillTried = new Set<string>();

  getModelsDir(): string { return whisperModelFiles.getModelsDir(); }
  async ensureModelsDirExists(): Promise<void> { return whisperModelFiles.ensureModelsDirExists(); }
  getModelPath(modelId: string): string { return whisperModelFiles.getModelPath(modelId); }
  async isModelDownloaded(modelId: string): Promise<boolean> { return whisperModelFiles.isModelDownloaded(modelId); }

  // Path where whisper.cpp looks for a model's CoreML encoder: it derives it
  // from the ggml filename, `.bin` -> `-encoder.mlmodelc`. Keep in lockstep with
  // the load-time check below.
  private coreMLPathFor(modelId: string): string {
    return this.getModelPath(modelId).replace(/\.bin$/i, '-encoder.mlmodelc');
  }

  /** True when this model's CoreML encoder is present on disk (iOS only). */
  async hasCoreMLEncoder(modelId: string): Promise<boolean> {
    if (Platform.OS !== 'ios') return false;
    return RNFS.exists(this.coreMLPathFor(modelId));
  }

  /**
   * iOS only: download + unzip a model's CoreML encoder next to its .bin so
   * whisper.cpp can run the encoder on the Apple Neural Engine (~2-3x faster
   * encode, frees the CPU). Non-fatal - on any failure the model still works on
   * CPU. No-op on Android, when the model has no published encoder, or when it's
   * already present.
   */
  async ensureCoreMLEncoder(modelId: string, onProgress?: (p: number) => void): Promise<boolean> {
    if (Platform.OS !== 'ios') return false;
    const model = WHISPER_MODELS.find(m => m.id === modelId);
    if (!model?.coreMLUrl) return false;
    const targetDir = this.coreMLPathFor(modelId); // ggml-<id>-encoder.mlmodelc
    if (await RNFS.exists(targetDir)) return true;
    await this.ensureModelsDirExists();
    const zipPath = `${this.getModelsDir()}/ggml-${modelId}-encoder.mlmodelc.zip`;
    await RNFS.unlink(zipPath).catch(() => {}); // clear any partial from a prior run
    try {
      logger.log(`[Whisper][CoreML] START download ${modelId} from ${model.coreMLUrl}`);
      const t0 = Date.now();
      let lastPct = -1;
      const { promise } = RNFS.downloadFile({
        fromUrl: model.coreMLUrl,
        toFile: zipPath,
        progressInterval: 500,
        progress: (r) => {
          if (r.contentLength <= 0) return;
          const frac = r.bytesWritten / r.contentLength;
          onProgress?.(frac);
          const pct = Math.floor(frac * 10) * 10; // log each 10%
          if (pct !== lastPct) {
            lastPct = pct;
            logger.log(`[Whisper][CoreML] ${modelId} ${pct}% (${(r.bytesWritten / 1e6).toFixed(0)}/${(r.contentLength / 1e6).toFixed(0)} MB)`);
          }
        },
      });
      const res = await promise;
      if (res.statusCode && res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}`);
      const zipMB = (Number((await RNFS.stat(zipPath)).size) / 1e6).toFixed(0);
      logger.log(`[Whisper][CoreML] downloaded ${modelId} (${zipMB} MB) in ${((Date.now() - t0) / 1000).toFixed(1)}s — unzipping`);
      await unzip(zipPath, this.getModelsDir());
      await RNFS.unlink(zipPath).catch(() => {});
      // The zip's top-level dir is named after the SOURCE encoder in the URL. For
      // most models that already equals targetDir; when a model reuses another's
      // encoder (tdrz -> small.en) the names differ, so rename it into place.
      const extractedName = model.coreMLUrl.split('/').pop()!.replace(/\.zip$/i, '');
      const extractedDir = `${this.getModelsDir()}/${extractedName}`;
      if (extractedDir !== targetDir && (await RNFS.exists(extractedDir))) {
        await RNFS.unlink(targetDir).catch(() => {}); // clear any stale target
        await RNFS.moveFile(extractedDir, targetDir);
        logger.log(`[Whisper][CoreML] reused ${extractedName} → ${targetDir.split('/').pop()}`);
      }
      const ok = await RNFS.exists(targetDir);
      logger.log(`[Whisper][CoreML] ${ok ? `READY for ${modelId} — next load will use the Neural Engine` : `FAILED for ${modelId}: no encoder dir after unzip`}`);
      return ok;
    } catch (e) {
      logger.warn(`[Whisper][CoreML] fetch FAILED for ${modelId} (staying CPU-only): ${String(e)}`);
      await RNFS.unlink(zipPath).catch(() => {});
      return false;
    }
  }

  async downloadModel(modelId: string, onProgress?: (progress: number) => void): Promise<string> {
    const model = WHISPER_MODELS.find(m => m.id === modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    await this.ensureModelsDirExists();
    const destPath = this.getModelPath(modelId);
    if (await RNFS.exists(destPath)) return destPath;
    logger.log(`[Whisper] Downloading ${model.name} via background download service...`);
    const fileName = `ggml-${modelId}.bin`;
    // WHISPER_MODELS sizes are in MB; seed totalBytes so progress renders before
    // the first byte arrives. The native layer refines this from the server's
    // Content-Length once the download starts.
    const totalBytes = model.size * 1024 * 1024;
    const modelKey = makeModelKey(`whisper-${modelId}`, fileName);
    // Publish a QUEUED row to the CANONICAL store IMMEDIATELY, before the (possibly
    // slot-limited) native start — the same pattern text/image use (startModelDownload).
    // Previously the store entry was only added AFTER a concurrency slot opened, so a
    // queued STT download had no canonical entry and the Transcription tab fell back to
    // the whisper store's progress=0 and rendered "0%" instead of "Queued". Every card
    // now reads this one store, so queued looks identical across Text/Image/STT.
    const QUEUED_PLACEHOLDER_ID = `queued:${modelKey}`;
    useDownloadStore.getState().add({
      modelKey,
      downloadId: QUEUED_PLACEHOLDER_ID,
      modelId: `whisper-${modelId}`,
      fileName,
      quantization: '',
      modelType: 'stt',
      status: 'pending',
      bytesDownloaded: 0,
      totalBytes,
      combinedTotalBytes: totalBytes,
      progress: 0,
      createdAt: Date.now(),
    });
    const { downloadIdPromise, promise } = backgroundDownloadService.downloadFileTo({
      params: {
        url: model.url,
        fileName,
        modelId: `whisper-${modelId}`,
        // Pass modelKey so the background queue's double-tap coalesce keys by the SAME
        // id as the canonical store entry (queued:<modelKey> → real), not the modelId
        // fallback — keeps queued dedup/cancel consistent across both layers.
        modelKey,
        // Tag as speech-to-text so the Download Manager files an in-progress
        // download under Voice. Without it the entry defaulted to 'text' and
        // STT models showed up under Text (and never under the Voice filter).
        modelType: 'stt',
        totalBytes,
        // Skip the Android worker's strict final-size check. `totalBytes` above
        // is a rounded-MB approximation (e.g. base.en 142 MB = 148,897,792 B vs
        // the real 147,964,211 B) — the discrepancy is largest for smaller
        // models. The worker compares the downloaded size to the expected total
        // within 0.1%, and since whisper.cpp ships no SHA to verify against, a
        // fully-downloaded file was deleted as FILE_CORRUPTED. The URL is pinned
        // to ggerganov/whisper.cpp; integrity is covered by HTTPS + the host
        // allowlist (matches how curated offgrid/* models opt out).
        metadataJson: JSON.stringify({ skipSizeValidation: true }),
      },
      destPath,
      onProgress: onProgress
        ? (bytesDownloaded, total) => {
            onProgress(total > 0 ? bytesDownloaded / total : 0);
          }
        : undefined,
      silent: true,
    });
    try {
      try {
        this.activeDownloadId = await downloadIdPromise;
        this.activeDownloadModelId = modelId;
        // A slot opened and the native download started: reconcile the queued
        // placeholder row to the REAL downloadId so progress events (routed by id)
        // land on it. Progress is then driven by the global onAnyProgress listener
        // in useDownloadListeners.
        useDownloadStore.getState().retryEntry(modelKey, this.activeDownloadId);
        await promise;
      } catch (error) {
        if ((error as { cancelled?: boolean })?.cancelled) {
          logger.log(`[Whisper] Download cancelled: ${modelId}`);
        } else {
          logger.error('[Whisper] Download failed:', error);
        }
        // Remove any partial file (a user cancel already deletes it natively; this
        // also covers the error case). Rethrow so the store clears its progress.
        await RNFS.unlink(destPath).catch(() => {});
        throw error;
      } finally {
        this.activeDownloadId = null;
        this.activeDownloadModelId = null;
      }
      try {
        await this.validateModelFile(destPath);
      } catch (validationError) {
        await RNFS.unlink(destPath).catch(err => logger.error('[Whisper] Failed to delete invalid model file:', err));
        throw new Error(`Downloaded model file is invalid: ${validationError instanceof Error ? validationError.message : 'unknown error'}`);
      }
    } finally {
      // Completed STT models are listed from disk by useVoiceDownloadItems, so
      // the in-flight store entry must be dropped on success AND failure: leaving
      // it would show a stale/duplicate active row and block a re-download (add()
      // refuses when an entry already exists for this modelKey).
      useDownloadStore.getState().remove(modelKey);
    }
    // iOS: also fetch the CoreML encoder so the ANE can run the encoder. Non-fatal
    // and no-op off-iOS / when unpublished - the model is already usable on CPU.
    if (Platform.OS === 'ios') {
      await this.ensureCoreMLEncoder(modelId).catch(() => {});
    }
    logger.log(`[Whisper] Downloaded to ${destPath}`);
    return destPath;
  }
  /** List every downloaded ggml whisper model on disk (for the Download Manager). */
  async listDownloadedModels(): Promise<Array<{ modelId: string; fileName: string; sizeBytes: number; filePath: string }>> {
    return whisperModelFiles.listDownloadedModels();
  }

  async deleteModel(modelId: string): Promise<void> {
    // Only cancel the in-flight download if it belongs to THIS model. Deleting an
    // already-downloaded model must not abort an unrelated download that happens to
    // be running (previously it cancelled the single activeDownloadId regardless).
    if (this.activeDownloadId !== null && this.activeDownloadModelId === modelId) {
      await backgroundDownloadService.cancelDownload(this.activeDownloadId).catch(() => {});
      this.activeDownloadId = null;
      this.activeDownloadModelId = null;
    }
    const path = this.getModelPath(modelId);
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  }

  /**
   * Validate that a whisper model file exists and has a reasonable size
   * before passing it to the native layer. The native initWithModelPath
   * calls abort() on invalid files, which kills the process without
   * giving JS a chance to handle the error.
   */
  async validateModelFile(modelPath: string): Promise<void> {
    return whisperModelFiles.validateModelFile(modelPath);
  }

  /** Download a whisper model from an arbitrary URL (custom / non-catalogue models). */
  async downloadFromUrl(url: string, modelId: string, onProgress?: (progress: number) => void): Promise<string> {
    await this.ensureModelsDirExists();
    const destPath = this.getModelPath(modelId);
    if (await RNFS.exists(destPath)) return destPath;
    const download = RNFS.downloadFile({
      fromUrl: url, toFile: destPath, progressDivider: 1,
      progress: (res) => { onProgress?.(res.bytesWritten / res.contentLength); },
    });
    const result = await download.promise;
    if (result.statusCode !== 200) {
      await RNFS.unlink(destPath).catch(() => {});
      throw new Error(`Download failed with status ${result.statusCode}`);
    }
    try {
      await this.validateModelFile(destPath);
    } catch (validationError) {
      await RNFS.unlink(destPath).catch(() => {});
      throw validationError;
    }
    return destPath;
  }

  async loadModel(
    modelPath: string,
    options?: { useGpu?: boolean; useFlashAttn?: boolean; useCoreML?: boolean },
  ): Promise<void> {
    wireNativeWhisperLog();
    if (this.context && this.currentModelPath !== modelPath) await this.unloadModel();
    if (this.context && this.currentModelPath === modelPath) return;
    if (this.isReleasingContext) {
      logger.log('[WhisperService] Waiting for context release to finish before loading');
      await this.contextReleasePromise;
    }

    // Validate model file before passing to native layer.
    // Native initWithModelPath calls abort() on invalid files, crashing the app.
    await this.validateModelFile(modelPath);

    // CoreML runs the whisper encoder on the Apple Neural Engine (iOS only, ~2-3x
    // faster encode, frees the CPU). Drive it purely off the per-model encoder
    // asset: if ggml-<model>-encoder.mlmodelc sits next to the .bin we use CoreML,
    // else CPU. Enabling CoreML WITHOUT that asset makes whisper.rn fail to load it
    // and can crash at transcribe (0%) on some A12 devices (e.g. iPhone XS), so
    // presence is the gate - not a user toggle. Non-iOS never uses CoreML.
    let useCoreML = false;
    if (Platform.OS === 'ios') {
      const coreMLPath = modelPath.replace(/\.bin$/i, '-encoder.mlmodelc');
      useCoreML = await RNFS.exists(coreMLPath);
      if (useCoreML) {
        logger.log(`[Whisper][CoreML] encoder PRESENT for this model (${coreMLPath.split('/').pop()}) — requesting Neural Engine. Watch for whisper.cpp native line "Core ML model loaded" to confirm actual use.`);
      } else {
        if (options?.useCoreML) logger.warn('[Whisper] CoreML requested but encoder asset missing; using CPU instead');
        // Backfill: model was downloaded before CoreML shipping. Fetch its encoder
        // in the background (non-blocking, once per session) so the NEXT load uses
        // the ANE. This load stays CPU.
        const model = WHISPER_MODELS.find(m => this.getModelPath(m.id) === modelPath);
        if (model?.coreMLUrl && !this.coreMLBackfillTried.has(model.id)) {
          this.coreMLBackfillTried.add(model.id);
          logger.log(`[Whisper] CoreML encoder missing for ${model.id}; fetching in background for next load`);
          this.ensureCoreMLEncoder(model.id).catch(() => {});
        }
      }
    }

    logger.log(
      `[Whisper] Loading model: ${modelPath} useGpu=${options?.useGpu ?? false} ` +
        `useFlashAttn=${options?.useFlashAttn ?? false} useCoreML=${useCoreML}`,
    );
    try {
      // useGpu/useFlashAttn/useCoreMLIos are real whisper.rn runtime options but
      // absent from this version's WhisperContextOptions type, so pass via a cast.
      const initOpts: Record<string, unknown> = {
        filePath: modelPath,
        useGpu: options?.useGpu ?? false,
        useFlashAttn: options?.useFlashAttn ?? false,
        useCoreMLIos: useCoreML,
      };
      // Time initWhisper: this covers reading the .bin into memory AND, when
      // useCoreML is true, the one-time ANE compile of the .mlmodelc (whisper.cpp
      // logs "first run on a device may take a while"). If startup is slow, this
      // number vs the first "transcribe progress" elapsed tells us whether it's
      // load/compile or the first encode.
      const tInit = Date.now();
      this.context = await initWhisper(initOpts as unknown as Parameters<typeof initWhisper>[0]);
      this.currentModelPath = modelPath;
      logger.log(`[Whisper] Model loaded successfully — initWhisper took ${((Date.now() - tInit) / 1000).toFixed(1)}s (useCoreML=${useCoreML})`);
    } catch (error) {
      logger.error('[Whisper] Failed to load model:', error);
      this.context = null;
      this.currentModelPath = null;
      throw error;
    }
  }

  async unloadModel(): Promise<void> {
    if (!this.context) return;
    // Stop active transcription to prevent SIGSEGV on a freed context.
    // Realtime path (isTranscribing/stopFn):
    if (this.isTranscribing || this.stopFn) {
      logger.log('[WhisperService] Stopping active realtime transcription before unloading model');
      await this.stopTranscription();
      await this.transcriptionFullyStopped;
    }
    // File path (fileTranscribeStop): a resumable/whole-file transcribe can be
    // in flight on this same context (it survives navigation by design). Releasing
    // underneath it is a use-after-free, so cancel and await it first.
    if (this.fileTranscribeStop) {
      logger.log('[WhisperService] Stopping in-flight file transcription before unloading model');
      await this.stopFileTranscription();
    }
    if (this.isReleasingContext) { logger.log('[WhisperService] Context release already in progress, skipping'); return; }
    this.isReleasingContext = true;
    this.contextReleasePromise = (async () => {
      try { await this.context!.release(); } catch (error) { logger.error('[WhisperService] Error releasing context:', error); }
      finally { this.context = null; this.currentModelPath = null; this.isReleasingContext = false; }
    })()
    await this.contextReleasePromise;
  }
  isModelLoaded(): boolean { return this.context !== null; }
  getLoadedModelPath(): string | null { return this.currentModelPath; }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message: 'This app needs access to your microphone for voice input.',
            buttonPositive: 'OK',
            buttonNegative: 'Cancel',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch (error) {
        logger.error('[Whisper] Failed to request permission:', error);
        return false;
      }
    }
    if (Platform.OS === 'ios') {
      // Route iOS session setup through audioSessionManager — the SINGLE owner of
      // the AVAudioSession — instead of calling AudioSessionIos directly. The old
      // direct path set the category/active flag without updating the manager's
      // `mode`, so a later TTS ensurePlayback() saw a stale mode and could pick the
      // wrong session (silent TTS after realtime STT). ensureRecordingPermission
      // applies the playAndRecord session (which also triggers the mic prompt) AND
      // updates `mode`, returning false if activation threw (permission denied).
      return audioSessionManager.ensureRecordingPermission();
    }
    return true;
  }

  async startRealtimeTranscription(
    onResult: TranscriptionCallback,
    options?: {
      language?: string;
      maxLen?: number;
    }
  ): Promise<void> {
    logger.log('[WhisperService] startRealtimeTranscription called');
    logger.log('[WhisperService] Context exists:', !!this.context);
    logger.log('[WhisperService] isTranscribing:', this.isTranscribing);

    if (!this.context) {
      throw new Error('No Whisper model loaded');
    }

    // If already transcribing, force stop before starting new
    if (this.isTranscribing || this.stopFn) {
      logger.log('[WhisperService] Stopping previous transcription before starting new one');
      await this.stopTranscription();
      // Small delay to ensure cleanup
      await new Promise<void>(resolve => setTimeout(resolve, 100));
    }

    logger.log('[WhisperService] Requesting permissions...');
    const hasPermission = await this.requestPermissions();
    logger.log('[WhisperService] Permission granted:', hasPermission);

    if (!hasPermission) {
      throw new Error('Microphone permission denied');
    }

    this.isTranscribing = true;

    // Create a promise that resolves when the native side fully finishes
    let resolveTranscriptionStopped: () => void = () => {};
    this.transcriptionFullyStopped = new Promise<void>(resolve => {
      resolveTranscriptionStopped = resolve;
    });

    // B26/B28 ROOT: realtime capture yields NO audio on device (spoke, blank input). The reliable
    // pipeline is record→file→transcribeFile (the voice-mode path, T079). So we record the SAME
    // utterance to a file alongside the realtime stream, and on the stream's FINAL event, when it
    // produced no usable transcript, we transcribe the recorded FILE and deliver THAT as the
    // authoritative result — one uniform "voice in → transcribed text out" pipeline for every mode.
    // Best-effort: if the recorder can't start (permission/hardware), realtime alone still runs.
    let recordedFile = false;
    try {
      await audioRecorderService.startRecording();
      recordedFile = true;
      this.fallbackRecorderActive = true;
    } catch (recErr) {
      logger.error('[WhisperService] Fallback recorder failed to start (realtime only):', recErr);
    }

    // Resolve the authoritative transcript for the finished utterance: prefer the realtime result;
    // when it's empty (B26), transcribe the recorded file. Pure decision, one place.
    const resolveFinalText = async (realtimeText: string): Promise<string> => {
      if (cleanTranscription(realtimeText)) return realtimeText;
      if (!recordedFile) return realtimeText;
      try {
        const { path } = await audioRecorderService.stopRecording();
        this.fallbackRecorderActive = false;
        const fileText = await this.transcribeFile(path);
        logger.log(`[WhisperService] Realtime captured nothing — file transcript: "${fileText.slice(0, 50)}"`);
        return fileText;
      } catch (fileErr) {
        logger.error('[WhisperService] File-transcribe fallback failed:', fileErr);
        return realtimeText;
      }
    };

    try {
      // Guard: context could have been released during the async permission check
      if (!this.context) {
        this.isTranscribing = false;
        if (recordedFile) { audioRecorderService.cancelRecording(); this.fallbackRecorderActive = false; }
        resolveTranscriptionStopped();
        throw new Error('Whisper context was released before transcription could start');
      }

      logger.log('[WhisperService] Calling transcribeRealtime...');
      // Use the transcribeRealtime API
      const { stop, subscribe } = await this.context.transcribeRealtime({
        language: options?.language || 'en',
        maxLen: options?.maxLen || 0, // 0 = no limit
        realtimeAudioSec: 30, // Process in 30-second chunks
        realtimeAudioSliceSec: 3, // Slice every 3 seconds for faster intermediate results
        ...(Platform.OS === 'ios' && {
          audioSessionOnStartIos: {
            category: 'PlayAndRecord',
            options: ['AllowBluetooth', 'MixWithOthers'],
            mode: 'Default',
          },
          audioSessionOnStopIos: 'restore',
        }),
      });

      logger.log('[WhisperService] transcribeRealtime started successfully');
      this.stopFn = stop;

      subscribe((evt: RealtimeTranscribeEvent) => {
        logger.log('[WhisperService] Event received:', {
          isCapturing: evt.isCapturing,
          hasData: !!evt.data,
          text: evt.data?.result?.slice(0, 50),
        });

        // [WIRE] raw realtime transcription event shape from-device (voice-mode STT path) — full result +
        // segments + timing, so we can ground the realtime-transcript fixtures (distinct from file transcribe).
        logger.log(`[WIRE-STT-REALTIME] ${JSON.stringify(evt)}`);

        const { isCapturing, data, processTime, recordingTime } = evt;

        if (isCapturing) {
          // Live partial — surface immediately for the "listening…" preview.
          onResult({
            text: data?.result || '',
            isCapturing: true,
            processTime: processTime || 0,
            recordingTime: recordingTime || 0,
          });
          return;
        }

        // FINAL: the utterance ended. Deliver the authoritative transcript — the realtime result if
        // it captured anything, else the file transcript (B26 fix). Emit it as the single final event.
        logger.log('[WhisperService] Recording finished');
        void resolveFinalText(data?.result || '').then((finalText) => {
          onResult({
            text: finalText,
            isCapturing: false,
            processTime: processTime || 0,
            recordingTime: recordingTime || 0,
          });
          this.isTranscribing = false;
          this.stopFn = null;
          // Signal that native processing is complete - safe to release context
          resolveTranscriptionStopped();
        });
      });
    } catch (error) {
      if (recordedFile) { audioRecorderService.cancelRecording(); this.fallbackRecorderActive = false; }
      logger.error('[WhisperService] transcribeRealtime error:', error);
      this.isTranscribing = false;
      this.stopFn = null;
      resolveTranscriptionStopped();
      throw error;
    }
  }

  async stopTranscription(): Promise<void> {
    logger.log('[WhisperService] stopTranscription called');
    try {
      // Grab and clear stopFn atomically to prevent double-stop race conditions.
      // Two concurrent callers (e.g. trailing audio timeout + clearResult) could
      // both see stopFn as non-null and call it twice, causing SIGSEGV in
      // finishRealtimeTranscribeJob on the native side.
      const fn = this.stopFn;
      this.stopFn = null;
      if (fn) {
        // Guard: only call stop if context still exists
        // Calling stop on a freed context causes SIGSEGV
        if (this.context) {
          fn();
        } else {
          logger.log('[WhisperService] Context already released, skipping stopFn call');
        }
      }
    } catch (error) {
      logger.error('[WhisperService] Error stopping transcription:', error);
    } finally {
      this.isTranscribing = false;
      // Hand the audio session back to the single owner. Realtime STT set mode='record'
      // via ensureRecordingPermission on start; whisper.rn's audioSessionOnStopIos
      // restores the NATIVE session but leaves this owner's `mode` stuck at 'record', so
      // the next TTS ensurePlayback() early-returns and playback is silent after
      // dictation. restorePlaybackAfterRecording resets mode + re-asserts playback
      // (iOS only; Android is a no-op). Best-effort — never throw into the stop path.
      audioSessionManager.restorePlaybackAfterRecording().catch(() => {});
    }
  }

  /** Force reset state — also calls native stop to prevent SIGSEGV from orphaned jobs. */
  forceReset(): void {
    logger.log('[WhisperService] Force resetting state');
    // Atomic grab-and-clear to match stopTranscription's pattern and prevent double-stop
    const fn = this.stopFn;
    this.stopFn = null;
    if (fn && this.context) {
      try { fn(); } catch (e) { logger.error('[WhisperService] Error calling stopFn during forceReset:', e); }
    }
    // Also clear the whole-file transcription stop handle. forceReset previously reset only the realtime
    // stopFn; if it ran while a file transcription was in flight, fileTranscribeStop stayed non-null and
    // every subsequent transcribeFile threw WhisperBusyError ("already transcribing") until app restart.
    // Same atomic grab-and-clear + best-effort native stop (the handle may be async — fire and forget).
    const fileFn = this.fileTranscribeStop;
    this.fileTranscribeStop = null;
    if (fileFn) {
      try {
        const r = fileFn();
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch((e) => logger.warn(`[WhisperService] fileTranscribeStop threw during forceReset: ${String(e)}`));
        }
      } catch (e) { logger.error('[WhisperService] Error calling fileTranscribeStop during forceReset:', e); }
    }
    // Discard the parallel fallback recording (B26/B28) ONLY when THIS realtime session started it —
    // a cancelled/aborted realtime session must not leave the file recorder capturing (B11-class
    // leak), but we must never cancel a recording Voice.ts started (its direct/file-path modes share
    // the same audioRecorderService singleton). Owned recorder → cancel; anything else → left as-is.
    if (this.fallbackRecorderActive) { audioRecorderService.cancelRecording(); this.fallbackRecorderActive = false; }
    this.isTranscribing = false;
    this.transcriptionFullyStopped = Promise.resolve();
  }

  isCurrentlyTranscribing(): boolean { return this.isTranscribing; }

  // Transcribe a single audio file
  /** Build the whisper.rn transcribe options from our TranscribeFileOptions.
   * Extracted from transcribeFile to keep that method under the complexity limit. */
  private buildTranscribeOpts(
    options: TranscribeFileOptions | undefined,
    ctx: { language: string; maxThreads: number; nProcessors: number; tStart: number },
  ): Record<string, unknown> {
    const { language, maxThreads, nProcessors, tStart } = ctx;
    let lastProgressLog = 0;
    // 'auto' means "let Whisper sniff the first ~30s of audio and pick". whisper.rn
    // does this when the language field is omitted; passing 'auto' would be a literal code.
    const transcribeOpts: Record<string, unknown> = {
      onProgress: (progress: number) => {
        if (progress - lastProgressLog >= 10 || progress >= 100) {
          lastProgressLog = progress;
          logger.log(
            `[Whisper] transcribe progress ${progress.toFixed(0)}% ` +
              `elapsed=${((Date.now() - tStart) / 1000).toFixed(1)}s`,
          );
        }
        options?.onProgress?.(progress);
      },
    };
    if (language !== 'auto') transcribeOpts.language = language;
    // Do NOT condition on previously-decoded text (whisper.cpp -mc 0). On noisy /
    // ambient clips whisper otherwise falls into a repetition death-spiral,
    // looping the same token or phrase; clearing the text context is the standard
    // fix and the biggest lever against hallucinated repeats.
    transcribeOpts.maxContext = 0;
    // Vocabulary hint: whisper.cpp seeds decoding with this text so proper nouns
    // and jargon are spelled the user's way. Trimmed; empty is omitted entirely.
    const promptHint = options?.prompt?.trim();
    if (promptHint) transcribeOpts.prompt = promptHint;
    if (maxThreads > 0) transcribeOpts.maxThreads = maxThreads;
    if (nProcessors > 1) transcribeOpts.nProcessors = nProcessors;
    if (options?.offset && options.offset > 0) transcribeOpts.offset = Math.floor(options.offset);
    if (options?.duration && options.duration > 0) transcribeOpts.duration = Math.floor(options.duration);
    // Speaker-turn marking; whisper.cpp only honors this with a tdrz model (else a no-op).
    if (options?.diarize) transcribeOpts.tdrzEnable = true;
    // whisper.rn fires onNewSegments after every decoded chunk (cumulative text);
    // nProcessors > 1 disables it in whisper.cpp, so it only fires when nProcessors == 1.
    if (options?.onPartial || options?.onSegments) {
      transcribeOpts.onNewSegments = (eventData: {
        result: string;
        segments?: { text: string; t0: number; t1: number }[];
      }) => {
        try {
          options.onPartial?.(eventData.result);
          if (options.onSegments && Array.isArray(eventData.segments)) {
            options.onSegments(eventData.segments);
          }
        } catch (err) {
          logger.warn(`[Whisper] onPartial callback threw: ${String(err)}`);
        }
      };
    }
    return transcribeOpts;
  }

  async transcribeFile(
    filePath: string,
    options?: TranscribeFileOptions,
  ): Promise<string> {
    wireNativeWhisperLog();
    if (!this.context) {
      throw new Error('No Whisper model loaded');
    }
    // Single shared context: refuse a second overlapping file transcription
    // instead of overwriting the in-flight job's cancel handle (which would leave
    // the first job un-cancellable and both racing the one native context).
    if (this.fileTranscribeStop) {
      throw new WhisperBusyError();
    }

    const requestedLanguage = options?.language || 'auto';
    // English-only models (ggml-*.en) have ONLY English tokens. Asking them for
    // any other language - via auto-detect (which returns garbage like "tg") OR an
    // explicit pick like "fr" - makes whisper unstable on iOS: it crashes at 0%,
    // thrashes (762s for 13%, 0 segments), or garbles. So force English for ANY
    // English-only model, whatever was requested. Use the catalogue's `lang`
    // metadata; fall back to the filename convention for custom models. (To
    // transcribe other languages, a multilingual model like ggml-base.bin is needed.)
    const modelFile = (this.currentModelPath ?? '').split('/').pop() ?? '';
    const catalogModel = WHISPER_MODELS.find((m) => m.url.endsWith(modelFile));
    const isEnglishOnlyModel = catalogModel ? catalogModel.lang === 'en' : /\.en\.bin$/i.test(modelFile);
    const language = isEnglishOnlyModel ? 'en' : requestedLanguage;
    const maxThreads = options?.maxThreads ?? 0;
    const nProcessors = options?.nProcessors ?? 1;
    const loadedPath = this.currentModelPath ?? '(unknown)';
    const gpu = (this.context as unknown as { gpu?: boolean }).gpu;

    logger.log(
      `[Whisper] transcribeFile START path=${filePath} lang=${language} ` +
        `maxThreads=${maxThreads} nProcessors=${nProcessors} ` +
        `model=${loadedPath} gpu=${gpu}`,
    );
    const tStart = Date.now();

    // whisper.rn's new_segment_callback used to crash the iOS file path (its
    // user_data was a stack struct that died before the callback fired); our
    // whisper.rn+0.5.5 patch hoists it so streaming works on both platforms.
    const transcribeOpts = this.buildTranscribeOpts(options, {
      language,
      maxThreads,
      nProcessors,
      tStart,
    });

    logger.log(`[Whisper] dispatching native transcribe (lang=${language} diarize=${options?.diarize ?? false} threads=${maxThreads} nProc=${nProcessors}) — awaiting first progress...`);
    const { stop, promise } = this.context.transcribe(
      filePath,
      transcribeOpts as Parameters<WhisperContext['transcribe']>[1],
    );
    this.fileTranscribeStop = stop;

    try {
      const res = await promise;
      const result = res.result;
      // The local whisper.rn type shim only declares `result`; segments exist
      // at runtime (whisper.cpp t0/t1 in centiseconds).
      const segments = (res as unknown as {
        segments?: { text: string; t0: number; t1: number }[];
      }).segments;
      if (options?.onSegments && Array.isArray(segments)) {
        try {
          options.onSegments(segments);
        } catch (err) {
          logger.warn(`[Whisper] onSegments callback threw: ${String(err)}`);
        }
      }
      const totalMs = Date.now() - tStart;
      logger.log(
        `[Whisper] transcribeFile DONE elapsed=${(totalMs / 1000).toFixed(1)}s ` +
          `outputLen=${result.length} preview="${result.slice(0, 100)}"`,
      );
      return cleanTranscription(result);
    } catch (e) {
      const totalMs = Date.now() - tStart;
      logger.error(`[Whisper] transcribeFile FAILED after ${(totalMs / 1000).toFixed(1)}s`, e);
      throw e;
    } finally {
      this.fileTranscribeStop = null;
    }
  }

  /**
   * Cancels an in-flight file transcription. The Stop button calls this so
   * whisper.cpp actually stops, otherwise the next Transcribe tap throws
   * "Context is already transcribing".
   */
  async stopFileTranscription(): Promise<void> {
    const fn = this.fileTranscribeStop;
    this.fileTranscribeStop = null;
    if (!fn) {
      logger.log('[Whisper] stopFileTranscription: no active file transcription');
      return;
    }
    logger.log('[Whisper] stopFileTranscription: cancelling native job');
    try { await fn(); }
    catch (e) { logger.warn(`[Whisper] stopFileTranscription threw: ${String(e)}`); }
  }
}

export const whisperService = new WhisperService();
