export const TTS_BACKBONE_MODEL = {
  id: 'outetts-0.3-500m-q4',
  name: 'OuteTTS 0.3',
  backboneFile: 'OuteTTS-0.3-500M-Q4_K_M.gguf',
  backboneUrl:
    'https://huggingface.co/OuteAI/OuteTTS-0.3-500M-GGUF/resolve/main/OuteTTS-0.3-500M-Q4_K_M.gguf',
  backboneSizeMB: 454,
  vocoderFile: 'WavTokenizer-Large-75-Q5_1.gguf',
  vocoderUrl:
    'https://huggingface.co/ggml-org/WavTokenizer/resolve/main/WavTokenizer-Large-75-Q5_1.gguf',
  vocoderSizeMB: 73,
  sampleRate: 24000,
  description: 'Natural-sounding on-device speech. Requires ~530 MB storage.',
};

export const TTS_SPEAKER_PROFILES = [
  { id: '0', label: 'Default' },
];

/** Warn user if device RAM is below this threshold */
export const TTS_WARN_RAM_GB = 8;
/** Hard-block TTS on devices below this threshold */
export const TTS_BLOCK_RAM_GB = 6;
/** Max cached audio messages per conversation before eviction */
export const AUDIO_CACHE_MAX_MESSAGES = 50;
