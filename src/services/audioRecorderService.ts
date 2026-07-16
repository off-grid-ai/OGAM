import { AudioRecorder, FileFormat, FileDirectory, BitDepth, IOSAudioQuality, FlacCompressionLevel } from 'react-native-audio-api';
import { PermissionsAndroid, Platform } from 'react-native';
import { audioSessionManager } from './audioSessionManager';
import logger from '../utils/logger';

/** Supported formats for llama.rn audio input */
type AudioInputFormat = 'wav' | 'mp3';

class AudioRecorderService {
  private recorder: AudioRecorder | null = null;
  private isRecording = false;

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
    if (this.isRecording) {
      await this.stopRecording().catch(() => {});
    }
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      throw new Error('Microphone permission denied');
    }
    // The recorder needs an active record-capable AVAudioSession. The session is
    // owned by audioSessionManager (the single owner) — it uses playAndRecord so
    // TTS playback can share it, and restores a playback session when recording
    // ends so later playback isn't left on a record session (the silent-playback bug).
    await audioSessionManager.ensureRecording();
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
    const startResult: any = rec.start();
    if (startResult && startResult.status && startResult.status !== 'success') {
      this.isRecording = false;
      this.recorder = null;
      // Recording never started — hand the session back to playback so it isn't
      // left stranded in record mode.
      audioSessionManager.restorePlaybackAfterRecording().catch(() => {});
      throw new Error(`Recording failed to start: ${startResult.errorMessage ?? startResult.error ?? startResult.status}`);
    }
  }

  async stopRecording(): Promise<{ path: string; durationSeconds: number }> {
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
    logger.log(`[WIRE-RECORDER] ${JSON.stringify({ platform: Platform.OS, path, durationSeconds, status: result.status })}`); // [WIRE] real recorder output (voice-note file/duration)
    return { path, durationSeconds };
  }

  cancelRecording(): void {
    if (!this.isRecording || !this.recorder) return;
    this.recorder.stop();
    this.isRecording = false;
    this.recorder = null;
    // Best-effort session restore (fire-and-forget — keep this method sync).
    audioSessionManager.restorePlaybackAfterRecording().catch(() => {});
  }

  isCurrentlyRecording(): boolean {
    return this.isRecording;
  }
}

export const audioRecorderService = new AudioRecorderService();
