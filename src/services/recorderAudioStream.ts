import type {
  AudioStreamData,
  AudioStreamInterface,
} from 'whisper.rn/realtime-transcription/types';
import { audioRecorderService } from './audioRecorderService';

/** What whisper.rn transcribes: mono 16 kHz. The recorder's buffer callback is asked for the same. */
const SAMPLE_RATE = 16000;

/** Float samples in -1..1 as the 16-bit little-endian PCM whisper.rn's realtime transcriber reads. */
export function toPcm16(samples: Float32Array): Uint8Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(pcm.buffer);
}

/**
 * The microphone, as whisper.rn's realtime transcriber reads it.
 *
 * The app's recorder owns the microphone: it writes the recording the final transcript comes from.
 * This stream only listens to that recorder's buffers, so one capture feeds both the live preview
 * and the file. Starting or stopping the stream never starts or stops the recorder.
 */
export class RecorderAudioStream implements AudioStreamInterface {
  private unsubscribe: (() => void) | null = null;
  private dataCallback?: (data: AudioStreamData) => void;
  private statusCallback?: (isRecording: boolean) => void;

  async initialize(): Promise<void> {}

  async start(): Promise<void> {
    if (this.unsubscribe) return;
    this.unsubscribe = audioRecorderService.onAudioSamples(samples => {
      this.dataCallback?.({
        data: toPcm16(samples),
        sampleRate: SAMPLE_RATE,
        channels: 1,
        timestamp: Date.now(),
      });
    });
    this.statusCallback?.(true);
  }

  async stop(): Promise<void> {
    if (!this.unsubscribe) return;
    this.unsubscribe();
    this.unsubscribe = null;
    this.statusCallback?.(false);
  }

  isRecording(): boolean {
    return this.unsubscribe !== null;
  }

  onData(callback: (data: AudioStreamData) => void): void {
    this.dataCallback = callback;
  }

  /** The recorder reports its own failures to the session; the stream has none of its own. */
  onError(): void {}

  onStatusChange(callback: (isRecording: boolean) => void): void {
    this.statusCallback = callback;
  }

  async release(): Promise<void> {
    await this.stop();
  }
}
