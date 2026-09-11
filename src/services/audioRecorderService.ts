import { AudioRecorder, FileFormat, FileDirectory, BitDepth, IOSAudioQuality, FlacCompressionLevel } from 'react-native-audio-api';
import { PermissionsAndroid, Platform } from 'react-native';
import { audioSessionManager } from './audioSessionManager';
import logger from '../utils/logger';
import { logVoiceDiagnostic, voiceDiagnosticError } from '../utils/voiceDiagnostics';

/** Supported formats for llama.rn audio input */
type AudioInputFormat = 'wav' | 'mp3';

/** How loud the microphone is right now, 0 upwards. RMS of one buffer of PCM samples. */
type AudioLevelListener = (rms: number) => void;

class AudioRecorderService {
  private recorder: AudioRecorder | null = null;
  private isRecording = false;
  private readonly levelListeners = new Set<AudioLevelListener>();

  /**
   * Listen to how loud the microphone is, while something is recording.
   *
   * End-of-speech has to be decided from the AUDIO. The transcript is a bad silence signal: each
   * realtime slice re-decodes the whole buffer, so the text keeps shifting while the room is quiet
   * and "the transcript settled" never becomes true.
   *
   * Returns an unsubscribe. Samples are reduced to one number here and never leave this service.
   */
  /**
   * Whether the platform is subtracting our own output from the microphone.
   *
   * The recorder answers this because it is what configures capture on each platform - iOS through the
   * record session's mode, Android through Oboe's input preset. Callers that decide whether the mic
   * may stay open while the assistant speaks ask HERE rather than hardcoding a belief about the
   * platform, which is how a reverted session mode would otherwise become an assistant that
   * interrupts itself with its own voice.
   *
   * Android: Oboe opens the input with the VoiceCommunication preset, which maps to
   * VOICE_COMMUNICATION - a capture source the platform must back with an echo canceller. Patched into
   * react-native-audio-api, whose default preset (VoiceRecognition) deliberately disables AEC.
   */
  isEchoCancelled(): boolean {
    // FALSE on both platforms, deliberately, and the reason is not a missing setting.
    //
    // An AVAudioSession MODE is only a hint. Real cancellation needs the voice-processing I/O unit to
    // drive INPUT and OUTPUT together, so it has a reference signal for what the speaker is playing.
    // Our TTS plays through an ordinary AudioContext, which that unit never sees - so on device the
    // mic recorded the assistant, speech detection fired on the assistant's own voice, and the
    // assistant cut itself off mid-sentence.
    //
    // Android is the same story from the other end: Oboe's VoiceCommunication preset asks the platform
    // for a cancelling capture source, but our playback does not go out through that path either.
    //
    // Kept as a question with a single owner rather than deleted: when playback and capture share a
    // voice-processing engine, this returns true and hands-free can listen through the assistant with
    // no other change. Until then it waits for the assistant to finish, which is honest and works.
    return false;
  }

  onAudioLevel(listener: AudioLevelListener): () => void {
    this.levelListeners.add(listener);
    if (this.recorder && this.isRecording) this.attachLevelCallback(this.recorder);
    return () => {
      this.levelListeners.delete(listener);
      if (this.levelListeners.size === 0) {
        (this.recorder as unknown as { clearOnAudioReady?: () => void })?.clearOnAudioReady?.();
      }
    };
  }

  private attachLevelCallback(rec: AudioRecorder): void {
    const withCallback = rec as unknown as {
      onAudioReady?: (
        options: { sampleRate: number; bufferLength: number; channelCount: number },
        callback: (event: { buffer?: { getChannelData?: (i: number) => Float32Array }; numFrames?: number }) => void,
      ) => void;
    };
    if (typeof withCallback.onAudioReady !== 'function') {
      // The whole endpoint depends on these buffers. If the method is not there, say so once rather
      // than leave a turn that silently never ends.
      logger.log('[VAD] onAudioReady is NOT available on this recorder - no levels will arrive');
      return;
    }
    logger.log('[VAD] attaching level callback');
    let seen = 0;
    try {
      withCallback.onAudioReady(
        { sampleRate: 16000, bufferLength: 1600, channelCount: 1 },
        event => {
          const channel = event?.buffer?.getChannelData?.(0);
          const frames = event?.numFrames ?? channel?.length ?? 0;
          if (seen === 0) {
            logger.log(`[VAD] first buffer frames=${frames} hasChannel=${!!channel}`);
          }
          seen += 1;
          if (!channel || frames <= 0) return;
          let sum = 0;
          for (let i = 0; i < frames; i += 1) sum += channel[i] * channel[i];
          const rms = Math.sqrt(sum / frames);
          for (const listener of this.levelListeners) {
            try {
              listener(rms);
            } catch {
              // One bad listener must never take the recording down with it.
            }
          }
        },
      );
    } catch (error) {
      // No buffer callback on this platform build: callers keep their own timeout.
      logger.log(`[VAD] onAudioReady threw: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  supportsDirectAudioInput(): boolean {
    return true;
  }

  getFormat(): AudioInputFormat {
    return 'wav';
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message: 'This app needs microphone access for voice input.',
            buttonPositive: 'OK',
            buttonNegative: 'Cancel',
          },
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch {
        return false;
      }
    }
    return true; // iOS: triggered by AVAudioSession on first use
  }

  async startRecording(): Promise<void> {
    logVoiceDiagnostic('microphone_start_requested', {
      alreadyRecording: this.isRecording,
    });
    if (this.isRecording) {
      // Do not start a second recorder when the previous recorder could not stop truthfully.
      await this.stopRecording();
    }
    const hasPermission = await this.requestPermissions();
    logVoiceDiagnostic('microphone_permission_finished', { granted: hasPermission });
    if (!hasPermission) {
      throw new Error('Microphone permission denied');
    }
    // The recorder needs an active record-capable AVAudioSession. The session is
    // owned by audioSessionManager (the single owner) — it uses playAndRecord so
    // TTS playback can share it, and restores a playback session when recording
    // ends so later playback isn't left on a record session (the silent-playback bug).
    try {
      await audioSessionManager.ensureRecording();
      logVoiceDiagnostic('microphone_audio_session_ready');
    } catch (error) {
      logVoiceDiagnostic('microphone_audio_session_failed', {
        error: voiceDiagnosticError(error),
      });
      throw error;
    }
    const rec = new AudioRecorder();
    // Whisper requires 16 kHz mono int16 PCM.
    // Set sampleRate via preset so the WAV header and data match what whisper.rn expects.
    rec.enableFileOutput({
      format: FileFormat.Wav,
      directory: FileDirectory.Document,
      subDirectory: 'audio-input',
      fileNamePrefix: `input_${Date.now()}`,
      channelCount: 1,
      preset: {
        sampleRate: 16000,
        bitDepth: BitDepth.Bit16,
        bitRate: 256000,
        iosQuality: IOSAudioQuality.High,
        flacCompressionLevel: FlacCompressionLevel.L5,
      },
    });
    this.recorder = rec;
    this.isRecording = true;
    // Before start, so the opening buffers are not missed.
    if (this.levelListeners.size > 0) this.attachLevelCallback(rec);
    const startResult: any = rec.start();
    if (startResult && startResult.status && startResult.status !== 'success') {
      this.isRecording = false;
      this.recorder = null;
      // Recording never started — hand the session back to playback so it isn't
      // left stranded in record mode.
      audioSessionManager.restorePlaybackAfterRecording().catch(error => {
        logger.error('[AudioRecorder] Audio session restore after failed start failed:', error);
      });
      throw new Error(`Recording failed to start: ${startResult.errorMessage ?? startResult.error ?? startResult.status}`);
    }
    logVoiceDiagnostic('microphone_started', {
      nativeStatus: startResult?.status ?? 'no-status',
    });
  }

  async stopRecording(): Promise<{ path: string; durationSeconds: number }> {
    logVoiceDiagnostic('microphone_stop_requested', {
      recording: this.isRecording,
      recorderReady: Boolean(this.recorder),
    });
    if (!this.isRecording || !this.recorder) {
      throw new Error('No active recording');
    }
    const result = this.recorder.stop();
    this.isRecording = false;
    this.recorder = null;
    // Hand the session back to playback so a voice note played next is audible.
    await audioSessionManager.restorePlaybackAfterRecording();
    if (result.status !== 'success') {
      throw new Error('Recording failed to save');
    }
    const path = result.path;
    const durationSeconds = (result as any).duration ?? 0;
    logVoiceDiagnostic('microphone_stopped', {
      nativeStatus: result.status,
      durationSeconds,
    });
    logger.log(`[WIRE-RECORDER] ${JSON.stringify({ platform: Platform.OS, path, durationSeconds, status: result.status })}`); // [WIRE] real recorder output (voice-note file/duration)
    return { path, durationSeconds };
  }

  cancelRecording(): void {
    if (!this.isRecording || !this.recorder) return;
    this.recorder.stop();
    this.isRecording = false;
    this.recorder = null;
    // Best-effort session restore (fire-and-forget — keep this method sync).
    audioSessionManager.restorePlaybackAfterRecording().catch(error => {
      logger.error('[AudioRecorder] Audio session restore after cancellation failed:', error);
    });
  }

  isCurrentlyRecording(): boolean {
    return this.isRecording;
  }
}

export const audioRecorderService = new AudioRecorderService();
