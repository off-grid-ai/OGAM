declare module 'whisper.rn' {
  export interface WhisperContextOptions {
    filePath: string;
    coreMLModelAsset?: {
      filename: string;
      assets: any[];
    };
  }

  export interface TranscribeOptions {
    language?: string;
    maxLen?: number;
    onProgress?: (progress: number) => void;
  }

  export interface TranscribeRealtimeOptions {
    language?: string;
    maxLen?: number;
    realtimeAudioSec?: number;
    realtimeAudioSliceSec?: number;
    audioSessionOnStartIos?: any;
    audioSessionOnStopIos?: any;
  }

  export interface TranscribeResult {
    result: string;
  }

  export interface RealtimeTranscribeEvent {
    isCapturing: boolean;
    data?: {
      result: string;
    };
    processTime?: number;
    recordingTime?: number;
  }

  export interface WhisperContext {
    transcribe(
      filePath: string | number,
      options?: TranscribeOptions
    ): {
      stop: () => void;
      promise: Promise<TranscribeResult>;
    };

    transcribeRealtime(
      options?: TranscribeRealtimeOptions
    ): Promise<{
      stop: () => void;
      subscribe: (callback: (event: RealtimeTranscribeEvent) => void) => void;
    }>;

    release(): Promise<void>;
  }

  export function initWhisper(options: WhisperContextOptions): Promise<WhisperContext>;

  export function releaseAllWhisper(): Promise<void>;

  // --- Voice Activity Detection (Silero VAD) ---
  export interface VadSegment {
    // Detected speech segment start/end in CENTISECONDS (whisper.cpp:
    // samples/SAMPLE_RATE*100). Multiply by 10 for milliseconds.
    t0: number;
    t1: number;
  }

  export interface VadOptions {
    threshold?: number;
    minSpeechDurationMs?: number;
    minSilenceDurationMs?: number;
    maxSpeechDurationS?: number;
    speechPadMs?: number;
    samplesOverlap?: number;
  }

  export interface VadContextOptions {
    filePath: string | number;
    isBundleAsset?: boolean;
    useGpu?: boolean;
    nThreads?: number;
  }

  export interface WhisperVadContext {
    detectSpeech(
      filePathOrBase64: string | number,
      options?: VadOptions
    ): Promise<VadSegment[]>;
    detectSpeechData(
      audioData: string | ArrayBuffer,
      options?: VadOptions
    ): Promise<VadSegment[]>;
    release(): Promise<void>;
  }

  export function initWhisperVad(options: VadContextOptions): Promise<WhisperVadContext>;

  export function releaseAllWhisperVad(): Promise<void>;

  export const AudioSessionIos: {
    Category: {
      PlayAndRecord: string;
      Playback: string;
      Record: string;
    };
    CategoryOption: {
      MixWithOthers: string;
      AllowBluetooth: string;
    };
    Mode: {
      Default: string;
      VoiceChat: string;
    };
    setCategory(category: string, options?: string[]): Promise<void>;
    setMode(mode: string): Promise<void>;
    setActive(active: boolean): Promise<void>;
  };
}
