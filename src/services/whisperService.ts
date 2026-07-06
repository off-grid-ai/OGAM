import { initWhisper, WhisperContext, RealtimeTranscribeEvent } from 'whisper.rn';
import { Platform, PermissionsAndroid } from 'react-native';
import RNFS from 'react-native-fs';
import logger from '../utils/logger';
import { audioSessionManager } from './audioSessionManager';
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

const GGML_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export const WHISPER_MODELS = [
  // ── English-only ──────────────────────────────────────────────────────────
  { id: 'tiny.en',   name: 'Tiny',   size: 75,   lang: 'en',    url: `${GGML_BASE}/ggml-tiny.en.bin`,   description: 'Fastest, English only' },
  { id: 'base.en',   name: 'Base',   size: 142,  lang: 'en',    url: `${GGML_BASE}/ggml-base.en.bin`,   description: 'Better accuracy, English only' },
  { id: 'small.en',  name: 'Small',  size: 466,  lang: 'en',    url: `${GGML_BASE}/ggml-small.en.bin`,  description: 'High accuracy, English only' },
  { id: 'medium.en', name: 'Medium', size: 1500, lang: 'en',    url: `${GGML_BASE}/ggml-medium.en.bin`, description: 'Near human-level, English only, ~2 GB RAM' },
  // ── Multilingual ──────────────────────────────────────────────────────────
  { id: 'tiny',           name: 'Tiny',             size: 75,   lang: 'multi', url: `${GGML_BASE}/ggml-tiny.bin`,           description: 'Fastest, 99 languages' },
  { id: 'base',           name: 'Base',             size: 142,  lang: 'multi', url: `${GGML_BASE}/ggml-base.bin`,           description: 'Better accuracy, 99 languages' },
  { id: 'small',          name: 'Small',            size: 466,  lang: 'multi', url: `${GGML_BASE}/ggml-small.bin`,          description: 'High accuracy, 99 languages' },
  { id: 'medium',         name: 'Medium',           size: 1500, lang: 'multi', url: `${GGML_BASE}/ggml-medium.bin`,         description: 'Near human-level, 99 languages, ~2 GB RAM' },
  { id: 'large-v3-turbo', name: 'Large v3 Turbo',  size: 809,  lang: 'multi', url: `${GGML_BASE}/ggml-large-v3-turbo.bin`, description: 'Fast + accurate, distilled large, 99 languages' },
  { id: 'large-v3',       name: 'Large v3',         size: 1550, lang: 'multi', url: `${GGML_BASE}/ggml-large-v3.bin`,       description: 'Best quality, 99 languages, ~3 GB RAM' },
];

class WhisperService {
  private context: WhisperContext | null = null;
  private currentModelPath: string | null = null;
  private isTranscribing: boolean = false;
  private stopFn: (() => void) | null = null;
  private isReleasingContext: boolean = false;
  private contextReleasePromise: Promise<void> = Promise.resolve();
  private transcriptionFullyStopped: Promise<void> = Promise.resolve();
  private activeDownloadId: string | null = null;

  getModelsDir(): string { return `${RNFS.DocumentDirectoryPath}/whisper-models`; }
  async ensureModelsDirExists(): Promise<void> {
    const dir = this.getModelsDir();
    if (!await RNFS.exists(dir)) await RNFS.mkdir(dir);
  }
  getModelPath(modelId: string): string { return `${this.getModelsDir()}/ggml-${modelId}.bin`; }
  async isModelDownloaded(modelId: string): Promise<boolean> { return RNFS.exists(this.getModelPath(modelId)); }

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
    logger.log(`[Whisper] Downloaded to ${destPath}`);
    return destPath;
  }
  /** List every downloaded ggml whisper model on disk (for the Download Manager). */
  async listDownloadedModels(): Promise<Array<{ modelId: string; fileName: string; sizeBytes: number; filePath: string }>> {
    const dir = this.getModelsDir();
    if (!(await RNFS.exists(dir))) return [];
    const entries = await RNFS.readDir(dir);
    return entries
      .filter(f => f.isFile() && f.name.startsWith('ggml-') && f.name.endsWith('.bin'))
      .map(f => ({
        modelId: f.name.replace(/^ggml-/, '').replace(/\.bin$/, ''),
        fileName: f.name,
        sizeBytes: Number(f.size) || 0,
        filePath: f.path,
      }));
  }

  async deleteModel(modelId: string): Promise<void> {
    if (this.activeDownloadId !== null) {
      await backgroundDownloadService.cancelDownload(this.activeDownloadId).catch(() => {});
      this.activeDownloadId = null;
    }
    const path = this.getModelPath(modelId);
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  }

  /**
   * Minimum valid model file size in bytes (10 MB).
   * The smallest whisper model (tiny) is ~75 MB, so anything under 10 MB
   * is almost certainly a corrupted or incomplete download.
   */
  private static readonly MIN_MODEL_FILE_SIZE = 10 * 1024 * 1024;

  /**
   * Validate that a whisper model file exists and has a reasonable size
   * before passing it to the native layer. The native initWithModelPath
   * calls abort() on invalid files, which kills the process without
   * giving JS a chance to handle the error.
   */
  async validateModelFile(modelPath: string): Promise<void> {
    if (!modelPath) {
      throw new Error('Whisper model path is empty or undefined');
    }

    const exists = await RNFS.exists(modelPath);
    if (!exists) {
      throw new Error(`Whisper model file not found at: ${modelPath}`);
    }

    const stat = await RNFS.stat(modelPath);
    const fileSize = Number(stat.size);
    if (Number.isNaN(fileSize) || fileSize < WhisperService.MIN_MODEL_FILE_SIZE) {
      // Remove the corrupted file so the user can re-download
      await RNFS.unlink(modelPath).catch(() => {});
      throw new Error(
        `Whisper model file is too small (${Math.round(fileSize / 1024)} KB) and likely corrupted. ` +
        'The file has been removed. Please re-download the model.'
      );
    }

    logger.log(`[Whisper] Model file validated: ${modelPath} (${Math.round(fileSize / (1024 * 1024))} MB)`);
  }

  async loadModel(modelPath: string): Promise<void> {
    if (this.context && this.currentModelPath !== modelPath) await this.unloadModel();
    if (this.context && this.currentModelPath === modelPath) return;
    if (this.isReleasingContext) {
      logger.log('[WhisperService] Waiting for context release to finish before loading');
      await this.contextReleasePromise;
    }

    // Validate model file before passing to native layer.
    // Native initWithModelPath calls abort() on invalid files, crashing the app.
    await this.validateModelFile(modelPath);

    logger.log(`[Whisper] Loading model: ${modelPath}`);
    try {
      this.context = await initWhisper({ filePath: modelPath });
      this.currentModelPath = modelPath;
      logger.log('[Whisper] Model loaded successfully');
    } catch (error) {
      logger.error('[Whisper] Failed to load model:', error);
      this.context = null;
      this.currentModelPath = null;
      throw error;
    }
  }

  async unloadModel(): Promise<void> {
    if (!this.context) return;
    // Stop active transcription to prevent SIGSEGV on freed context
    if (this.isTranscribing || this.stopFn) {
      logger.log('[WhisperService] Stopping active transcription before unloading model');
      await this.stopTranscription();
      await this.transcriptionFullyStopped;
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

    try {
      // Guard: context could have been released during the async permission check
      if (!this.context) {
        this.isTranscribing = false;
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

        const { isCapturing, data, processTime, recordingTime } = evt;
        onResult({
          text: data?.result || '',
          isCapturing,
          processTime: processTime || 0,
          recordingTime: recordingTime || 0,
        });

        if (!isCapturing) {
          logger.log('[WhisperService] Recording finished');
          this.isTranscribing = false;
          this.stopFn = null;
          // Signal that native processing is complete - safe to release context
          resolveTranscriptionStopped();
        }
      });
    } catch (error) {
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
    this.isTranscribing = false;
    this.transcriptionFullyStopped = Promise.resolve();
  }

  isCurrentlyTranscribing(): boolean { return this.isTranscribing; }

  // Transcribe a single audio file
  async transcribeFile(
    filePath: string,
    options?: {
      language?: string;
      onProgress?: (progress: number) => void;
    }
  ): Promise<string> {
    if (!this.context) {
      throw new Error('No Whisper model loaded');
    }

    const { promise } = this.context.transcribe(filePath, {
      language: options?.language || 'en',
      onProgress: options?.onProgress,
    });

    const { result } = await promise;
    return cleanTranscription(result);
  }
}

/**
 * Normalize a raw Whisper transcription: strip the non-speech markers Whisper
 * emits for silence/noise — [BLANK_AUDIO], [ Silence ], [MUSIC], (inaudible),
 * (speaking foreign language), etc. — and return '' when nothing but markers
 * (or punctuation) remains. Without this, a silent/too-short clip returned the
 * literal "[BLANK_AUDIO]" token, which then got SENT as the message text instead
 * of being treated as "couldn't hear that". The single place this rule lives, so
 * every path (file + realtime) treats no-speech identically.
 */
export function cleanTranscription(raw: string): string {
  if (!raw) return '';
  const stripped = raw
    .replace(/\[[^\]]*\]/g, ' ') // [BLANK_AUDIO], [ Silence ], [MUSIC]
    .replace(/\([^)]*\)/g, ' ')  // (silence), (speaking foreign language)
    .replace(/\s+/g, ' ')
    .trim();
  // Only markers / punctuation left → no real speech.
  if (!/[a-z0-9]/i.test(stripped)) return '';
  return stripped;
}

export const whisperService = new WhisperService();
