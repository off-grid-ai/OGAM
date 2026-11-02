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
    translate?: boolean;
    temperature?: number;
    beamSize?: number;
    prompt?: string;
    maxLen?: number;
    onProgress?: (progress: number) => void;
  }

  export interface TranscribeResult {
    result: string;
    language: string;
    segments: Array<{ text: string; t0: number; t1: number }>;
    isAborted: boolean;
  }

  export interface WhisperContext {
    transcribe(
      filePath: string | number,
      options?: TranscribeOptions
    ): {
      stop: () => void;
      promise: Promise<TranscribeResult>;
    };

    /** Transcribe 16 kHz mono 16-bit PCM. whisper.rn's realtime transcriber decodes each slice with it. */
    transcribeData(
      data: ArrayBuffer,
      options?: TranscribeOptions
    ): {
      stop: () => Promise<void>;
      promise: Promise<TranscribeResult>;
    };

    release(): Promise<void>;
  }

  export function initWhisper(options: WhisperContextOptions): Promise<WhisperContext>;

  export function releaseAllWhisper(): Promise<void>;
}
