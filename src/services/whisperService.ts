import {
  initWhisper,
  WhisperContext,
  RealtimeTranscribeEvent,
} from 'whisper.rn';
import { Platform, PermissionsAndroid } from 'react-native';
import logger from '../utils/logger';
import { audioSessionManager } from './audioSessionManager';
import { noteMicPermissionRefused } from './micPermission';
import { audioRecorderService } from './audioRecorderService';
import { cleanTranscription } from './whisperModels';
import * as whisperModelFiles from './whisperModelFiles';
import { whisperDecodeOptions } from './whisperDecodeOptions';
import { RealtimeStartBarrier } from './realtimeStartBarrier';
import { WhisperModelDownloads } from './whisperModelDownloads';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { remoteMediaRuntime } from './remoteMediaRuntime';
import { featureUsed, generationStarted } from './analytics/analytics';
import { modelRef } from './analytics/values';
import { fileName } from './analytics/scrub';
import { QwenAsrEngine } from './qwenAsrEngine';
import { isQwenAsrModelId, QWEN_ASR_MODEL_ID } from './qwenAsrModel';

// Re-export the model catalog + transcription normalizer (moved to whisperModels.ts
// to keep this file within the max-lines budget). Behavior-neutral: every existing
// `import { WHISPER_MODELS, cleanTranscription } from './whisperService'` keeps working.
export { WHISPER_MODELS, cleanTranscription } from './whisperModels';

interface TranscriptionResult {
  text: string;
  isCapturing: boolean;
  processTime: number;
  recordingTime: number;
}
type TranscriptionCallback = (result: TranscriptionResult) => void;

/** What the person reads when Qwen3-ASR could not transcribe a recording. */
export const ASR_FELL_BACK_NOTICE = "Qwen3-ASR couldn't transcribe that, so Whisper did.";
export const ASR_FAILED_NOTICE = "Qwen3-ASR couldn't transcribe that. Try again, or download a Whisper model.";

/** A recording transcribed by Qwen3-ASR, or by Whisper after Qwen3-ASR failed. */
interface AsrOutcome {
  text: string;
  notice?: string;
}

class WhisperService {
  private context: WhisperContext | null = null;
  private currentModelPath: string | null = null;
  private isTranscribing: boolean = false;
  private stopFn: (() => Promise<void>) | null = null;
  /** Counts live sessions, so a finishing session only clears state it still owns. */
  private realtimeSession = 0;
  private readonly realtimeStart = new RealtimeStartBarrier();
  private isReleasingContext: boolean = false;
  private remoteTranscription: AbortController | null = null;
  private contextReleasePromise: Promise<void> = Promise.resolve();
  private transcriptionFullyStopped: Promise<void> = Promise.resolve();
  /**
   * The context runs one native job at a time: a realtime session (with its file fallback), a file
   * transcription, or the release. whisper.rn's own guards check a flag and then act, so overlapping
   * jobs reached the native side together. On iOS a finishing file job cleared the job the live
   * audio callback reads (SIGSEGV in AudioInputCallback); on Android a release freed the weights a
   * running encoder still read (SIGSEGV in wsp_ggml_vec_dot_f16).
   */
  private nativeLane: Promise<void> = Promise.resolve();
  private readonly modelDownloads = new WhisperModelDownloads();
  /** The selected model when it is Qwen3-ASR: a llama.rn context with the audio projector. */
  private readonly asrEngine = new QwenAsrEngine();
  /** A live Qwen3-ASR recording; cancel drops its result and ends the session. */
  private asrSession: { cancel: () => void } | null = null;
  private readonly noticeListeners = new Set<(notice: string) => void>();

  /** Hear every one-line notice about a transcription (shown in the composer). */
  onNotice(listener: (notice: string) => void): () => void {
    this.noticeListeners.add(listener);
    return () => {
      this.noticeListeners.delete(listener);
    };
  }

  private notify(notice: string): void {
    this.noticeListeners.forEach(listener => listener(notice));
  }

  /** Wait for every earlier native job, then hold the context until the returned leave() is called. */
  private enterNativeLane(): Promise<() => void> {
    const previous = this.nativeLane;
    let leave: () => void = () => {};
    this.nativeLane = new Promise<void>(resolve => {
      leave = resolve;
    });
    return previous.then(() => leave);
  }

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

  async downloadModel(
    modelId: string,
    onProgress?: (progress: number) => void,
  ): Promise<string> {
    return this.modelDownloads.downloadModel(modelId, onProgress);
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
    return this.modelDownloads.listDownloadedModels();
  }

  async deleteModel(modelId: string): Promise<void> {
    return this.modelDownloads.deleteModel(modelId);
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
    const asrFiles = whisperModelFiles.getQwenAsrFilesForPath(modelPath);
    if (asrFiles) {
      await this.loadAsrModel(modelPath, asrFiles);
      return;
    }
    if (this.asrEngine.isLoaded()) await this.unloadModel();
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

  /** Load the selected Qwen3-ASR model in place of any Whisper context. */
  private async loadAsrModel(
    modelPath: string,
    files: NonNullable<ReturnType<typeof whisperModelFiles.getQwenAsrFilesForPath>>,
  ): Promise<void> {
    if (this.asrEngine.isLoaded() && this.currentModelPath === modelPath) return;
    if (this.context || this.asrEngine.isLoaded()) await this.unloadModel();
    if (this.isReleasingContext) await this.contextReleasePromise;
    await whisperModelFiles.validateQwenAsrFiles(files);
    try {
      await this.asrEngine.load(files);
      this.currentModelPath = modelPath;
      logger.log('[Whisper] Qwen3-ASR model loaded');
    } catch (error) {
      logger.error('[Whisper] Failed to load Qwen3-ASR model:', error);
      this.currentModelPath = null;
      throw error;
    }
  }

  async unloadModel(): Promise<void> {
    if (!this.context && !this.asrEngine.isLoaded()) return;
    // Stop active transcription to prevent SIGSEGV on freed context
    if (this.isTranscribing || this.stopFn) {
      logger.log(
        '[WhisperService] Stopping active transcription before unloading model',
      );
      await this.stopTranscription();
      await this.transcriptionFullyStopped;
    }
    if (this.isReleasingContext) {
      logger.log(
        '[WhisperService] Context release already in progress, skipping',
      );
      return;
    }
    this.isReleasingContext = true;
    this.contextReleasePromise = (async () => {
      const leave = await this.enterNativeLane();
      try {
        await this.context?.release();
        await this.asrEngine.release();
      } catch (error) {
        logger.error('[WhisperService] Error releasing context:', error);
      } finally {
        this.context = null;
        this.currentModelPath = null;
        this.isReleasingContext = false;
        leave();
      }
    })();
    await this.contextReleasePromise;
  }
  isModelLoaded(): boolean {
    return this.context !== null || this.asrEngine.isLoaded();
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
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) noteMicPermissionRefused();
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
    },
  ): Promise<void> {
    const language = options?.language || 'en';
    logger.log(`[WhisperService] start (context=${!!this.context})`);
    logger.log('[WhisperService] isTranscribing:', this.isTranscribing);

    if (this.asrEngine.isLoaded()) {
      await this.startAsrSession(onResult, language);
      return;
    }

    if (!this.context) {
      throw new Error('No Whisper model loaded');
    }

    // If already transcribing, force stop before starting new
    if (this.isTranscribing || this.stopFn) {
      logger.log(
        '[WhisperService] Stopping previous transcription before starting new one',
      );
      await this.stopTranscription();
      // Small delay to ensure cleanup
      await new Promise<void>(resolve => setTimeout(resolve, 100));
    }

    this.realtimeStart.begin();
    this.isTranscribing = true;
    const session = ++this.realtimeSession;
    featureUsed('voice_input');
    const endAnalytics = generationStarted('stt', {
      model: modelRef(fileName(this.currentModelPath)?.replace(/^ggml-|\.bin$/g, '')),
      engine: 'whisper',
      backend: 'cpu',
    });

    // Create a promise that resolves when the native side fully finishes. The session holds the
    // native lane until then, so a file job or a release never overlaps live capture.
    let resolveTranscriptionStopped: () => void = () => {};
    this.transcriptionFullyStopped = new Promise<void>(resolve => {
      resolveTranscriptionStopped = resolve;
    });
    const sessionStopped = this.transcriptionFullyStopped;
    const leaveLane = await this.enterNativeLane();
    // eslint-disable-next-line no-void
    void sessionStopped.then(leaveLane);

    let recordedFile = false;
    try {
      logger.log('[WhisperService] Requesting permissions...');
      const hasPermission = await this.requestPermissions();
      logger.log('[WhisperService] Permission granted:', hasPermission);

      if (!hasPermission) {
        // The person's choice, not a failure: no failed generation, no consent prompt.
        endAnalytics('stopped');
        throw new Error('Microphone permission denied');
      }

      // B26/B28 ROOT: realtime capture yields NO audio on device (spoke, blank input). The reliable
      // pipeline is record→file→transcribeFile (the voice-mode path, T079). So we record the SAME
      // utterance to a file alongside the realtime stream, and on the stream's FINAL event, when it
      // produced no usable transcript, we transcribe the recorded FILE and deliver THAT as the
      // authoritative result — one uniform "voice in → transcribed text out" pipeline for every mode.
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

      // Always close the parallel file recorder. Prefer a usable realtime result;
      // when it is empty (B26), transcribe the captured file instead.
      const resolveFinalText = async (
        realtimeText: string,
      ): Promise<string> => {
        if (!recordedFile) return realtimeText;
        try {
          const { path } = await audioRecorderService.stopRecording();
          if (cleanTranscription(realtimeText)) return realtimeText;
          // This session already holds the native lane; the fallback runs inside it.
          const fileText = await this.transcribeLocalFile(path, { language });
          logger.log(
            `[WhisperService] Realtime captured nothing — file transcript: ${fileText.length}ch`,
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
      // Use the transcribeRealtime API
      const { stop, subscribe } = await this.context.transcribeRealtime({
        ...whisperDecodeOptions(language),
        maxLen: options?.maxLen || 0, // 0 = no limit
        realtimeAudioSec: 30, // Process in 30-second chunks
        realtimeAudioSliceSec: 3, // Slice every 3 seconds for faster intermediate results
        // Decode only slices that contain speech, so a quiet room is not decoded into invented
        // words. This does NOT end the turn - only useVoiceInput does that, in voice mode.
        useVad: true,
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
          textLength: evt.data?.result?.length ?? 0,
        });
        // [WIRE] raw realtime transcription event shape from-device (voice-mode STT path) — full result +
        // segments + timing, so we can ground the realtime-transcript fixtures (distinct from file transcribe).
        logger.log(`[WIRE-STT-REALTIME] ${JSON.stringify({ isCapturing: evt.isCapturing, textLength: evt.data?.result?.length ?? 0, processTime: evt.processTime, recordingTime: evt.recordingTime })}`);

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
          endAnalytics('done');
          onResult({
            text: finalText,
            isCapturing: false,
            processTime: processTime || 0,
            recordingTime: recordingTime || 0,
          });
          // A newer session may already be waiting for the lane: its state is not ours to clear.
          if (session === this.realtimeSession) {
            this.isTranscribing = false;
            this.stopFn = null;
          }
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
      endAnalytics('failed', { error });
      this.isTranscribing = false;
      this.stopFn = null;
      resolveTranscriptionStopped();
      throw error;
    }
  }

  async stopTranscription(): Promise<void> {
    logger.log('[WhisperService] stopTranscription called');
    const remoteTranscription = this.remoteTranscription;
    const stoppedRemote = !!remoteTranscription;
    if (remoteTranscription) {
      remoteTranscription.abort();
      this.remoteTranscription = null;
    }
    try {
      if (!stoppedRemote && !this.stopFn) {
        logger.log('[WhisperService] Stop is waiting for realtime startup');
        await this.realtimeStart.wait();
      }
      // Grab and clear stopFn atomically to prevent double-stop race conditions.
      // Two concurrent callers (e.g. trailing audio timeout + clearResult) could
      // both see stopFn as non-null and call it twice, causing SIGSEGV in
      // finishRealtimeTranscribeJob on the native side.
      const fn = stoppedRemote ? null : this.stopFn;
      this.stopFn = null;
      if (fn) {
        // Guard: only call stop if context still exists
        // Calling stop on a freed context causes SIGSEGV
        if (this.context || this.asrSession) {
          await fn();
        } else {
          logger.log(
            '[WhisperService] Context already released, skipping stopFn call',
          );
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
  async forceReset(): Promise<void> {
    logger.log('[WhisperService] Force resetting state');
    await this.realtimeStart.wait();
    // Atomic grab-and-clear to match stopTranscription's pattern and prevent double-stop
    const fn = this.stopFn;
    this.stopFn = null;
    if (this.asrSession) {
      // A Qwen3-ASR session holds only the recorder: drop it, and drop any result still coming.
      this.asrSession.cancel();
      return;
    }
    const activeTranscriptionStopped = this.transcriptionFullyStopped;
    const nativeStop =
      fn && this.context
        ? Promise.resolve()
            .then(fn)
            .catch(e =>
              logger.error(
                '[WhisperService] Error calling stopFn during forceReset:',
                e,
              ),
            )
        : Promise.resolve();
    // Keep both parts of realtime teardown behind one barrier. Native stop can emit
    // the final event, whose empty-result fallback still transcribes the recorded
    // file. Do not release or reuse the Whisper context until both have finished.
    this.transcriptionFullyStopped =
      fn && this.context
        ? Promise.all([nativeStop, activeTranscriptionStopped]).then(
            () => undefined,
          )
        : nativeStop;
    // Discard the parallel fallback recording (B26/B28) if one is mid-flight — a cancelled/aborted
    // realtime session must not leave the file recorder capturing (B11-class leak).
    if (audioRecorderService.isCurrentlyRecording())
      audioRecorderService.cancelRecording();
    this.isTranscribing = false;
    await this.transcriptionFullyStopped;
  }

  isCurrentlyTranscribing(): boolean {
    return this.isTranscribing;
  }

  // Transcribe a single audio file
  async transcribeFile(
    filePath: string,
    options?: {
      language?: string;
      onProgress?: (progress: number) => void;
    },
  ): Promise<string> {
    const remoteServer = useRemoteServerStore
      .getState()
      .getActiveRemoteMediaServer('transcription');
    if (remoteServer?.mediaModels?.transcription) {
      const controller = new AbortController();
      this.remoteTranscription = controller;
      try {
        return cleanTranscription(
          await remoteMediaRuntime.transcribe(
            remoteServer,
            { fileUri: filePath, language: options?.language },
            { signal: controller.signal },
          ),
        );
      } finally {
        if (this.remoteTranscription === controller)
          this.remoteTranscription = null;
      }
    }
    const leave = await this.enterNativeLane();
    try {
      return await this.transcribeLocalFile(filePath, options);
    } finally {
      leave();
    }
  }

  /** The native file transcription. The caller must hold the native lane. */
  private async transcribeLocalFile(
    filePath: string,
    options?: {
      language?: string;
      onProgress?: (progress: number) => void;
    },
  ): Promise<string> {
    if (this.asrEngine.isLoaded()) {
      const { text, notice } = await this.transcribeWithAsr(filePath, options?.language);
      // Nothing came back and nothing could stand in: a failure, not silence.
      if (!text && notice === ASR_FAILED_NOTICE) throw new Error(notice);
      return text;
    }
    if (!this.context) {
      throw new Error('No Whisper model loaded');
    }

    const language = options?.language || 'en';
    logger.log(
      `[WhisperService] Transcribing file with language=${language} model=${
        this.currentModelPath ?? 'unknown'
      }`,
    );
    const { promise } = this.context.transcribe(filePath, {
      ...whisperDecodeOptions(language),
      onProgress: options?.onProgress,
    });

    const __res = await promise;
    // Shape only: the transcript is what the person said and never goes in the log.
    logger.log(`[WIRE-STT] ${JSON.stringify({ textLength: __res?.result?.length ?? 0 })}`);
    const { result } = __res;
    return cleanTranscription(result);
  }

  /**
   * Qwen3-ASR has no live stream: record the utterance to a file, and on stop transcribe that file
   * and deliver it as the session's one final result.
   */
  private async startAsrSession(onResult: TranscriptionCallback, language: string): Promise<void> {
    if (this.isTranscribing || this.stopFn) await this.stopTranscription();
    this.realtimeStart.begin();
    this.isTranscribing = true;
    const session = ++this.realtimeSession;
    featureUsed('voice_input');
    const endAnalytics = generationStarted('stt', {
      model: modelRef(QWEN_ASR_MODEL_ID),
      engine: 'qwen3-asr',
      backend: Platform.OS === 'ios' ? 'metal' : 'cpu',
    });
    let resolveStopped: () => void = () => {};
    this.transcriptionFullyStopped = new Promise<void>(resolve => {
      resolveStopped = resolve;
    });
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      // A newer session may already be recording: its state is not ours to clear.
      if (session === this.realtimeSession) {
        this.isTranscribing = false;
        this.stopFn = null;
        this.asrSession = null;
      }
      resolveStopped();
    };
    const deliver = (outcome: AsrOutcome) => {
      if (ended) return;
      onResult({ text: outcome.text, isCapturing: false, processTime: 0, recordingTime: 0 });
      end();
    };
    try {
      if (!(await this.requestPermissions())) {
        endAnalytics('stopped');
        throw new Error('Microphone permission denied');
      }
      await audioRecorderService.startRecording();
      this.asrSession = {
        cancel: () => {
          if (audioRecorderService.isCurrentlyRecording()) audioRecorderService.cancelRecording();
          endAnalytics('stopped');
          end();
        },
      };
      this.stopFn = async () => {
        try {
          const { path } = await audioRecorderService.stopRecording();
          // The transcription outlives stop(), as whisper.rn's final event does.
          // eslint-disable-next-line no-void
          void this.enterNativeLane().then(async leave => {
            try {
              const outcome = await this.transcribeWithAsr(path, language);
              endAnalytics(outcome.notice === ASR_FAILED_NOTICE ? 'failed' : 'done');
              deliver(outcome);
            } catch (error) {
              logger.error('[WhisperService] Qwen3-ASR transcription did not finish:', error);
              endAnalytics('failed', { error });
              deliver({ text: '' });
            } finally {
              leave();
            }
          });
        } catch (error) {
          logger.error('[WhisperService] Qwen3-ASR recording failed to stop:', error);
          endAnalytics('failed', { error });
          deliver({ text: '' });
        }
      };
      this.realtimeStart.settle();
    } catch (error) {
      this.realtimeStart.settle();
      endAnalytics('failed', { error });
      end();
      throw error;
    }
  }

  /**
   * Transcribe a recording with Qwen3-ASR. When it fails, a downloaded Whisper model transcribes it
   * instead. Either way the person is told in one line. The caller holds the native lane.
   */
  private async transcribeWithAsr(filePath: string, language?: string): Promise<AsrOutcome> {
    const outcome = await this.transcribeWithAsrOrWhisper(filePath, language);
    if (outcome.notice) this.notify(outcome.notice);
    return outcome;
  }

  private async transcribeWithAsrOrWhisper(filePath: string, language?: string): Promise<AsrOutcome> {
    try {
      return { text: cleanTranscription(await this.asrEngine.transcribe(filePath, language)) };
    } catch (error) {
      logger.error('[WhisperService] Qwen3-ASR transcription failed:', error);
    }
    const fallback = await this.whisperFallbackPath(language);
    if (!fallback) return { text: '', notice: ASR_FAILED_NOTICE };
    try {
      // Free Qwen3-ASR first: the two never share memory. The next turn loads it again.
      await this.asrEngine.release();
      this.currentModelPath = null;
      await this.loadModel(fallback);
      return { text: await this.transcribeLocalFile(filePath, { language }), notice: ASR_FELL_BACK_NOTICE };
    } catch (error) {
      logger.error('[WhisperService] Whisper fallback failed:', error);
      return { text: '', notice: ASR_FAILED_NOTICE };
    }
  }

  /** The smallest downloaded Whisper model that speaks the language, for a Qwen3-ASR fallback. */
  private async whisperFallbackPath(language?: string): Promise<string | null> {
    const whisper = (await whisperModelFiles.listDownloadedModels())
      .filter(model => !isQwenAsrModelId(model.modelId))
      .filter(model => language === 'en' || !model.modelId.endsWith('.en'))
      .sort((a, b) => a.sizeBytes - b.sizeBytes);
    return whisper[0]?.filePath ?? null;
  }
}

export const whisperService = new WhisperService();
