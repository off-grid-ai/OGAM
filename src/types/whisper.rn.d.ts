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
    language?: string;
    /** Timed segments; t0/t1 are in 10 ms steps. */
    segments?: { text: string; t0: number; t1: number }[];
    isAborted?: boolean;
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
