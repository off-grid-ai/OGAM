// Extends the Message interface with Audio Mode fields.
// Kept separate to avoid exceeding the line limit in types/index.ts.

declare module './index' {
  interface Message {
    /** Audio Mode: path to PCM file on disk */
    audioPath?: string;
    /** Audio Mode: 200-point amplitude envelope for waveform bar */
    waveformData?: number[];
    /** Audio Mode: total audio duration in seconds */
    audioDurationSeconds?: number;
    /** True while TTS is generating audio for this message */
    isGeneratingAudio?: boolean;
  }
}

export {};
