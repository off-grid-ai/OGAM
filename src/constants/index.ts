// External URLs
export const WEDNESDAY_URL = 'https://wednesday.is';

// Off Grid AI Desktop: the free, open-source desktop app (not a Pro feature).
// Linked from Pro screens and from remote-server discovery alike.
export const OFF_GRID_DESKTOP_URL = 'https://getoffgridai.co/desktop';
export const OFF_GRID_DESKTOP_BENEFIT =
  'More power, same privacy. Run bigger models on Mac or Windows and keep every device in sync.';

export const PRO_AHA_FEATURES = [
  'Create images with the model active on your Desktop',
  'Transcribe speech with the model active on your Desktop',
  'Hear replies in the voice active on your Desktop',
  'Control which models your named Desktop serves',
];

// Hugging Face API configuration
export const HF_API = {
  baseUrl: 'https://huggingface.co',
  apiUrl: 'https://huggingface.co/api',
  modelsEndpoint: '/models',
  searchParams: {
    filter: 'gguf',
    sort: 'downloads',
    direction: '-1',
    limit: 30,
  },
};

// Model credibility configuration
// LM Studio community - highest credibility for GGUF models
export const LMSTUDIO_AUTHORS = ['lmstudio-community', 'lmstudio-ai'];

// Official model creators - these are the original model authors
export const OFFICIAL_MODEL_AUTHORS: Record<string, string> = {
  'meta-llama': 'Meta',
  microsoft: 'Microsoft',
  google: 'Google',
  Qwen: 'Alibaba',
  mistralai: 'Mistral AI',
  HuggingFaceTB: 'Hugging Face',
  HuggingFaceH4: 'Hugging Face',
  bigscience: 'BigScience',
  EleutherAI: 'EleutherAI',
  tiiuae: 'TII UAE',
  stabilityai: 'Stability AI',
  databricks: 'Databricks',
  THUDM: 'Tsinghua University',
  'baichuan-inc': 'Baichuan',
  internlm: 'InternLM',
  '01-ai': '01.AI',
  'deepseek-ai': 'DeepSeek',
  CohereForAI: 'Cohere',
  allenai: 'Allen AI',
  nvidia: 'NVIDIA',
  apple: 'Apple',
};

// Verified quantizers - trusted community members who quantize models
export const VERIFIED_QUANTIZERS: Record<string, string> = {
  TheBloke: 'TheBloke',
  bartowski: 'bartowski',
  QuantFactory: 'QuantFactory',
  mradermacher: 'mradermacher',
  'second-state': 'Second State',
  MaziyarPanahi: 'Maziyar Panahi',
  Triangle104: 'Triangle104',
  unsloth: 'Unsloth',
  'ggml-org': 'GGML (HuggingFace)',
};

// Credibility level labels
export const CREDIBILITY_LABELS = {
  lmstudio: {
    label: 'LM Studio',
    description: 'Official LM Studio quantization - highest quality GGUF',
    color: '#22D3EE', // cyan
  },
  official: {
    label: 'Official',
    description: 'From the original model creator',
    color: '#22C55E', // green
  },
  'verified-quantizer': {
    label: 'Verified',
    description: 'From a trusted quantization provider',
    color: '#A78BFA', // purple
  },
  community: {
    label: 'Community',
    description: 'Community contributed model',
    color: '#64748B', // gray
  },
};

// App configuration
export const APP_CONFIG = {
  modelStorageDir: 'models',
  whisperStorageDir: 'whisper-models',
  maxConcurrentDownloads: 1,
  defaultSystemPrompt: `You are a helpful AI assistant running locally on the user's device. Your responses should be:
- Accurate and factual - never make up information
- Concise but complete - answer the question fully without unnecessary elaboration
- Helpful and friendly - focus on solving the user's actual need
- Honest about limitations - if you don't know something, say so

If asked about yourself, you can mention you're a local AI assistant that prioritizes user privacy.`,
  streamingEnabled: true,
  maxContextLength: 4096, // Default context window; eliminates double-init on models that support ≥4096
};

export interface OnboardingSlide {
  id: string;
  keyword: string;
  title: string;
  description: string;
}

// Core onboarding slides. Optional feature packages contribute additional slide data through the
// onboarding.additionalSlides hook so Core keeps one renderer without advertising unavailable
// features in free builds.
export const ONBOARDING_SLIDES: readonly OnboardingSlide[] = [
  {
    id: 'freedom',
    keyword: 'YOURS',
    title: 'Your AI.\nNo Strings Attached.',
    description:
      'No subscriptions, no sign-ups, no company reading your chats. An AI that lives on your device and answers to no one else.',
  },
  {
    id: 'magic',
    keyword: 'MAGIC',
    title: 'Just Talk.\nIt Figures Out the Rest.',
    description:
      'Describe an image \u2014 it creates one. Show it a photo \u2014 it understands. Attach a document \u2014 it reads it. One conversation, no modes, no friction.',
  },
  {
    id: 'create',
    keyword: 'CREATE',
    title: 'Say It Simply.\nGet Something Stunning.',
    description:
      'Type \u201Cimagine a cat on the moon\u201D and watch your words become a vivid image in seconds. AI enhances your ideas automatically \u2014 no prompt engineering needed.',
  },
  {
    id: 'hardware',
    keyword: 'READY',
    title: 'Powered\nYour Way.',
    description:
      'Run models on your phone with Metal and Neural Engine acceleration \u2014 or connect to powerful models already on your home network. We\u2019ll find the best setup for you.',
  },
];

// Fonts
export const FONTS = {
  mono: 'Menlo',
};

// Typography Scale - Centralized font sizes and styles
export const TYPOGRAPHY = {
  // Display / Hero numbers
  display: {
    fontSize: 22,
    fontFamily: FONTS.mono,
    fontWeight: '200' as const,
    letterSpacing: -0.5,
  },

  // Headings
  h1: {
    fontSize: 24,
    fontFamily: FONTS.mono,
    fontWeight: '300' as const,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 16,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
    letterSpacing: -0.2,
  },
  h3: {
    fontSize: 13,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
    letterSpacing: -0.2,
  },

  // Body text
  body: {
    fontSize: 14,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
  },
  bodySmall: {
    fontSize: 13,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
  },

  // Labels (whispers)
  label: {
    fontSize: 10,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
    letterSpacing: 0.3,
  },
  labelSmall: {
    fontSize: 9,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
    letterSpacing: 0.3,
  },

  // Metadata / Details
  meta: {
    fontSize: 10,
    fontFamily: FONTS.mono,
    fontWeight: '300' as const,
  },
  metaSmall: {
    fontSize: 9,
    fontFamily: FONTS.mono,
    fontWeight: '300' as const,
  },
};

// Spacing Scale - Consistent whitespace
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};
