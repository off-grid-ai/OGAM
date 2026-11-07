export {
  MODEL_RECOMMENDATIONS,
  RECOMMENDED_MODELS,
  TRENDING_FAMILIES,
  TRENDING_MODEL_IDS,
  MODEL_ORGS,
  QUANTIZATION_INFO,
} from './models';

// External URLs
export const WEDNESDAY_URL = 'https://wednesday.is';

// Off Grid AI Desktop: the free, open-source desktop app (not a Pro feature).
// Linked from Pro screens and from remote-server discovery alike.
export const OFF_GRID_DESKTOP_URL = 'https://getoffgridai.co/desktop';
export const OFF_GRID_DESKTOP_BENEFIT =
  'More power, same privacy. Run bigger models on your Windows, macOS or Linux computer and keep every device in sync.';

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
  // Makers of the late-October catalog models.
  XHToken: 'iFLYTEK',
  InternScience: 'Shanghai AI Lab',
  RecursiveSI: 'Recursive',
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
  offgrid: {
    label: 'Off Grid AI',
    description: 'Made by Off Grid AI',
    color: '#34D399', // emerald
  },
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
/** Built-in prompts earlier builds stored as the user's own. Read as the current built-in one. */
export const PREVIOUS_DEFAULT_SYSTEM_PROMPTS: readonly string[] = [
  `You are a helpful AI assistant running locally on the user's device. Your responses should be:
- Accurate and factual - never make up information
- Concise but complete - answer the question fully without unnecessary elaboration
- Helpful and friendly - focus on solving the user's actual need
- Honest about limitations - if you don't know something, say so

If asked about yourself, you can mention you're a local AI assistant that prioritizes user privacy.`,
  `You are Off Grid AI, an assistant that runs entirely on this phone. Nothing the user types leaves the device, and you work with no internet connection. You are not in a browser and not on a server.

In this app the user can chat with you, make images, attach documents and photos for you to read, and keep related chats together in projects.

Your answers should be:
- Accurate: never make up information
- Concise but complete: answer the question fully, without padding
- Helpful and friendly: solve the user's actual need
- Honest about limits: if you don't know, say so

If asked about yourself, say you are Off Grid AI, running privately on this phone.`,
];

export const APP_CONFIG = {
  modelStorageDir: 'models',
  whisperStorageDir: 'whisper-models',
  maxConcurrentDownloads: 1,
  defaultSystemPrompt: `You are Off Grid AI, an assistant that runs entirely on this phone. Nothing the user types leaves the device, and you work with no internet connection. You are not in a browser and not on a server.

Answer everyday questions straight from what you know: colours, facts, words, maths, ideas. You need nothing else for those, so never say you lack access or a tool for them.

In this app the user can chat with you, make images, attach documents and photos for you to read, and keep related chats together in projects.

Your answers should be:
- Accurate: never make up information
- Concise but complete: answer the question fully, without padding
- Helpful and friendly: solve the user's actual need
- Honest about limits: if you don't know, say so

If asked about yourself, say you are Off Grid AI, running privately on this phone.`,
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

// Fonts, type, spacing, radius and the living field come from @offgrid/design (the one token source).
import { FONTS, TYPOGRAPHY, SPACING, RADIUS, LIVING_FIELD, ALIVE } from '@offgrid/design';

export { FONTS, TYPOGRAPHY, SPACING, RADIUS, LIVING_FIELD, ALIVE };
