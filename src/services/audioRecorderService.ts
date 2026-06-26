import { AudioRecorder, AudioManager, FileFormat, FileDirectory, BitDepth, IOSAudioQuality, FlacCompressionLevel } from 'react-native-audio-api';
import { PermissionsAndroid, Platform } from 'react-native';

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
    // iOS: the recorder requires an active AVAudioSession in a record-capable
    // category. Nothing else configures it, so native start() returns
    // "Audio session is not active" and the file never gets written (stop errors).
    // playAndRecord (not record) so TTS playback can also use the session;
    // defaultToSpeaker keeps replies on the loudspeaker, not the earpiece.
    if (Platform.OS === 'ios') {
      AudioManager.setAudioSessionOptions({
        iosCategory: 'playAndRecord',
        iosMode: 'default',
        iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'],
      });
      await AudioManager.setAudioSessionActivity(true);
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
    const startResult: any = rec.start();
    if (startResult && startResult.status && startResult.status !== 'success') {
      this.isRecording = false;
      this.recorder = null;
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
    if (result.status !== 'success') {
      throw new Error('Recording failed to save');
    }
    const path = result.path;
    const durationSeconds = (result as any).duration ?? 0;
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
