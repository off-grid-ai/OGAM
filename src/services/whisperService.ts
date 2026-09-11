import {
  initWhisper,
  WhisperContext,
  RealtimeTranscribeEvent,
} from 'whisper.rn';
import { Platform, PermissionsAndroid } from 'react-native';
import {
  cleanTranscription,
  GenerationAbortedError,
  whisperDecodeOptions,
} from '@offgrid/models';
import {
  WHISPER_REALTIME_OPTIONS,
  realtimeFinalSource,
  realtimeStartPlan,
  realtimeStopDecision,
} from '@offgrid/speech';
import { notReleased, RELEASED, type NativeRelease } from './nativeRelease';
import logger from '../utils/logger';
import { audioSessionManager } from './audioSessionManager';
import { audioRecorderService } from './audioRecorderService';
import * as whisperModelFiles from './whisperModelFiles';
import { RealtimeStartBarrier } from './realtimeStartBarrier';

interface RealtimeTranscriptionResult {
  text: string;
  isCapturing: boolean;
  processTime: number;
  recordingTime: number;
}
type TranscriptionCallback = (result: RealtimeTranscriptionResult) => void;

class WhisperService {
  private context: WhisperContext | null = null;
  private currentModelPath: string | null = null;
  private isTranscribing: boolean = false;
  private stopFn: (() => Promise<void>) | null = null;
  private readonly realtimeStart = new RealtimeStartBarrier();
  private isReleasingContext: boolean = false;
  private contextReleasePromise = Promise.resolve<NativeRelease>(RELEASED);
  private transcriptionFullyStopped: Promise<void> = Promise.resolve();

  getModelsDir(): string {
    return whisperModelFiles.getModelsDir();
  }
  async ensureModelsDirExists(): Promise<void> {
    return whisperModelFiles.ensureModelsDirExists();
  }
  getModelPath(modelId: string): string {
    return whisperModelFiles.getModelPath(modelId);
  }
  async isModelDownloaded(modelId: string): Promise<boolean> {
    return whisperModelFiles.isModelDownloaded(modelId);
  }

  /** List every downloaded ggml whisper model on disk (for the Download Manager). */
  async listDownloadedModels(): Promise<
    Array<{
      modelId: string;
      fileName: string;
      sizeBytes: number;
      filePath: string;
    }>
  > {
    return whisperModelFiles.listDownloadedModels();
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

  async loadModel(modelPath: string): Promise<void> {
    if (this.context && this.currentModelPath !== modelPath)
      await this.unloadModel();
    if (this.context && this.currentModelPath === modelPath) return;
    if (this.isReleasingContext) {
      logger.log(
        '[WhisperService] Waiting for context release to finish before loading',
      );
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

  /** Answers whether the engine LET GO: residency admits the next model into this memory. */
  async unloadModel(): Promise<NativeRelease> {
    if (!this.context) return RELEASED;
    // Stop active transcription to prevent SIGSEGV on freed context
    if (this.isTranscribing || this.stopFn) {
      logger.log(
        '[WhisperService] Stopping active transcription before unloading model',
      );
      await this.stopTranscription();
      await this.transcriptionFullyStopped;
    }
    // A skip must not read as success: answer with the in-flight release's own result.
    if (this.isReleasingContext) return this.contextReleasePromise;
    this.isReleasingContext = true;
    this.contextReleasePromise = (async () => {
      try {
        await this.context!.release();
        return RELEASED;
      } catch (error) {
        logger.error('[WhisperService] Error releasing context:', error);
        return notReleased(error);
      } finally {
        this.context = null;
        this.currentModelPath = null;
        this.isReleasingContext = false;
      }
    })();
    return this.contextReleasePromise;
  }
  isModelLoaded(): boolean {
    return this.context !== null;
  }
  getLoadedModelPath(): string | null {
    return this.currentModelPath;
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message:
              'This app needs access to your microphone for voice input.',
            buttonPositive: 'OK',
            buttonNegative: 'Cancel',
          },
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
      transcribeFallback?: (filePath: string) => Promise<string>;
    },
  ): Promise<void> {
    const language = options?.language || 'en';
    logger.log(`[WhisperService] start (context=${!!this.context})`);
    logger.log('[WhisperService] isTranscribing:', this.isTranscribing);

    if (!this.context) {
      throw new Error('No Whisper model loaded');
    }

    const startPlan = realtimeStartPlan({
      isTranscribing: this.isTranscribing,
      hasStopHandle: this.stopFn !== null,
    });
    if (startPlan.stopPrevious) {
      logger.log(
        '[WhisperService] Stopping previous transcription before starting new one',
      );
      await this.stopTranscription();
      await new Promise<void>(resolve => setTimeout(resolve, startPlan.settleMs));
    }

    this.realtimeStart.begin();
    this.isTranscribing = true;

    // Create a promise that resolves when the native side fully finishes
    let resolveTranscriptionStopped: () => void = () => {};
    this.transcriptionFullyStopped = new Promise<void>(resolve => {
      resolveTranscriptionStopped = resolve;
    });

    let recordedFile = false;
    try {
      logger.log('[WhisperService] Requesting permissions...');
      const hasPermission = await this.requestPermissions();
      logger.log('[WhisperService] Permission granted:', hasPermission);

      if (!hasPermission) {
        throw new Error('Microphone permission denied');
      }

      // Best-effort: if the recorder can't start (permission/hardware), realtime alone still runs.
      try {
        await audioRecorderService.startRecording();
        recordedFile = true;
      } catch (recErr) {
        logger.error(
          '[WhisperService] Fallback recorder failed to start (realtime only):',
          recErr,
        );
      }

      const resolveFinalText = async (realtimeText: string): Promise<string> => {
        const source = realtimeFinalSource({
          realtimeCleaned: cleanTranscription(realtimeText),
          fileRecorded: recordedFile,
        });
        if (!recordedFile) return realtimeText;
        try {
          const { path } = await audioRecorderService.stopRecording();
          if (source === 'realtime') return realtimeText;
          const fileText = options?.transcribeFallback
            ? await options.transcribeFallback(path)
            : await this.transcribeFileRaw(path, { language });
          logger.log(
            `[WhisperService] Realtime captured nothing — file transcript: "${fileText.slice(
              0,
              50,
            )}"`,
          );
          return fileText;
        } catch (fileErr) {
          logger.error(
            '[WhisperService] File-transcribe fallback failed:',
            fileErr,
          );
          return realtimeText;
        }
      };

      // Guard: context could have been released during the async permission check
      if (!this.context) {
        this.isTranscribing = false;
        if (recordedFile) audioRecorderService.cancelRecording();
        resolveTranscriptionStopped();
        throw new Error(
          'Whisper context was released before transcription could start',
        );
      }

      logger.log('[WhisperService] Calling transcribeRealtime...');
      const { stop, subscribe } = await this.context.transcribeRealtime({
        ...whisperDecodeOptions(language),
        ...WHISPER_REALTIME_OPTIONS,
        maxLen: options?.maxLen || WHISPER_REALTIME_OPTIONS.maxLen,
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
      this.stopFn = async () => {
        await stop();
      };
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
        // The native callback cannot await the fallback transcription.
        // eslint-disable-next-line no-void
        void resolveFinalText(data?.result || '').then(finalText => {
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
      // The native stop handle and its event subscriber now exist. A stop that
      // arrived during startup can continue and close this exact session.
      this.realtimeStart.settle();
    } catch (error) {
      this.realtimeStart.settle();
      if (recordedFile) audioRecorderService.cancelRecording();
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
      let decision = realtimeStopDecision({
        hasStopHandle: this.stopFn !== null,
        startPending: this.isTranscribing && this.stopFn === null,
        contextAlive: this.context !== null,
      });
      if (decision === 'wait-for-start') {
        logger.log('[WhisperService] Stop is waiting for realtime startup');
        await this.realtimeStart.wait();
        decision = realtimeStopDecision({
          hasStopHandle: this.stopFn !== null,
          startPending: false,
          contextAlive: this.context !== null,
        });
      }
      const fn = this.stopFn;
      this.stopFn = null;
      if (decision === 'stop' && fn) {
        await fn();
      } else if (decision === 'skip-context-released') {
        logger.log(
          '[WhisperService] Context already released, skipping stopFn call',
        );
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
      // (iOS only; Android is a no-op). A restore failure must stay visible even though it does not
      // replace the transcription stop result.
      await audioSessionManager.restorePlaybackAfterRecording().catch(error => {
        logger.error('[WhisperService] Audio session restore failed:', error);
      });
    }
  }

  /** Force reset state — also calls native stop to prevent SIGSEGV from orphaned jobs. */
  async forceReset(): Promise<void> {
    logger.log('[WhisperService] Force resetting state');
    await this.realtimeStart.wait();
    // Atomic grab-and-clear to match stopTranscription's pattern and prevent double-stop
    const fn = this.stopFn;
    this.stopFn = null;
    const activeTranscriptionStopped = this.transcriptionFullyStopped;
    const nativeStop =
      fn && this.context
        ? Promise.resolve()
            .then(fn)
        : Promise.resolve();
    // Keep both parts of realtime teardown behind one barrier. Native stop can emit
    // the final event, whose empty-result fallback still transcribes the recorded
    // file. Do not release or reuse the Whisper context until both have finished.
    const teardown = Promise.allSettled([
      nativeStop,
      activeTranscriptionStopped,
    ]).then(results => {
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failure) throw failure.reason;
    });
    // Keep the shared lifecycle barrier reusable after this caller receives the failure.
    this.transcriptionFullyStopped = teardown.catch(() => undefined);
    // Discard the parallel fallback recording (B26/B28) if one is mid-flight — a cancelled/aborted
    // realtime session must not leave the file recorder capturing (B11-class leak).
    if (audioRecorderService.isCurrentlyRecording())
      audioRecorderService.cancelRecording();
    this.isTranscribing = false;
    await teardown;
  }

  isCurrentlyTranscribing(): boolean {
    return this.isTranscribing;
  }

  /** Start one raw file transcription and expose the exact native stop leaf. */
  startFileTranscriptionRaw(
    filePath: string,
    options?: {
      language?: string;
      onProgress?: (progress: number) => void;
    },
  ): { promise: Promise<string>; stop: () => Promise<void> } {
    if (!this.context) {
      throw new Error('No Whisper model loaded');
    }

    const language = options?.language || 'en';
    logger.log(`[WhisperService] Transcribing file with language=${language} model=${this.currentModelPath ?? 'unknown'}`);
    const { promise, stop } = this.context.transcribe(filePath, {
      ...whisperDecodeOptions(language),
      onProgress: options?.onProgress,
    });
    return {
      stop: () => Promise.resolve(stop()),
      promise: promise.then(value => {
        logger.log(`[WIRE-STT] ${JSON.stringify(value)}`); // [WIRE] raw whisper.rn transcribe result (segments/text) from-device
        return cleanTranscription(value.result);
      }),
    };
  }

  async transcribeFileRaw(
    filePath: string,
    options?: {
      language?: string;
      onProgress?: (progress: number) => void;
      signal?: AbortSignal;
    },
  ): Promise<string> {
    if (options?.signal?.aborted) throw new GenerationAbortedError();
    const operation = this.startFileTranscriptionRaw(filePath, options);
    if (!options?.signal) return operation.promise;

    let cancelOperation: Promise<never> | null = null;
    let rejectCancellation: ((error: unknown) => void) | null = null;
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
    const abort = () => {
      if (cancelOperation) return;
      cancelOperation = Promise.resolve()
        .then(operation.stop)
        .then(() => { throw new GenerationAbortedError(); });
      cancelOperation.catch(error => rejectCancellation?.(error));
    };
    options.signal.addEventListener('abort', abort, { once: true });
    try {
      const result = await Promise.race([operation.promise, cancelled]);
      if (options.signal.aborted) {
        abort();
        await cancelOperation;
      }
      return result;
    } finally {
      options.signal.removeEventListener('abort', abort);
    }
  }
}

export const whisperService = new WhisperService();
