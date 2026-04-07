import { AudioRecorder, FileFormat, FileDirectory } from 'react-native-audio-api';
import { PermissionsAndroid, Platform } from 'react-native';
import logger from '../utils/logger';

/** Supported formats for llama.rn audio input */
export type AudioInputFormat = 'wav' | 'mp3';

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
    const rec = new AudioRecorder();
    rec.enableFileOutput({
      format: FileFormat.Wav,
      directory: FileDirectory.Document,
      subDirectory: 'audio-input',
      fileNamePrefix: `input_${Date.now()}`,
      channelCount: 1,
    });
    this.recorder = rec;
    this.isRecording = true;
    rec.start();
    logger.log('[AudioRecorder] Recording started');
  }

  async stopRecording(): Promise<{ path: string; durationSeconds: number }> {
    if (!this.isRecording || !this.recorder) {
      throw new Error('No active recording');
    }
    const result = this.recorder.stop();
    this.isRecording = false;
    this.recorder = null;
    if (result.status !== 'success') {
      throw new Error('Recording failed to save');
    }
    const path = result.path;
    const durationSeconds = (result as any).duration ?? 0;
    logger.log('[AudioRecorder] Saved to:', path, 'duration:', durationSeconds);
    return { path, durationSeconds };
  }

  cancelRecording(): void {
    if (!this.isRecording || !this.recorder) return;
    this.recorder.stop();
    this.isRecording = false;
    this.recorder = null;
  }

  isCurrentlyRecording(): boolean {
    return this.isRecording;
  }
}

export const audioRecorderService = new AudioRecorderService();
