// Model size recommendations based on device RAM
export const MODEL_RECOMMENDATIONS = {
  // RAM in GB -> max model parameters in billions
  memoryToParams: [
    { minRam: 3, maxRam: 4, maxParams: 1.5, quantization: 'Q4_K_M' },
    { minRam: 4, maxRam: 6, maxParams: 3, quantization: 'Q4_K_M' },
    { minRam: 6, maxRam: 8, maxParams: 4, quantization: 'Q4_K_M' },
    { minRam: 8, maxRam: 12, maxParams: 8, quantization: 'Q4_K_M' },
    { minRam: 12, maxRam: 16, maxParams: 13, quantization: 'Q4_K_M' },
    { minRam: 16, maxRam: Infinity, maxParams: 30, quantization: 'Q4_K_M' },
  ],
};

// Curated list of recommended models for mobile (updated Sep 2026)
// Ordered editorially: MiniCPM5 featured first, then Gemma 4, Qwen 3.5, and others.
export const RECOMMENDED_MODELS = [
  // --- MiniCPM5 (featured) ---
  {
    id: 'openbmb/MiniCPM5-2B-GGUF',
    name: 'MiniCPM5 2B',
    params: 2,
    description: 'Strong coding, reasoning, and tool use with 128K context',
    minRam: 4,
    type: 'text' as const,
    org: 'openbmb',
    isNew: true,
  },
  // --- Gemma 4 (featured) ---
  {
    id: 'unsloth/gemma-4-E2B-it-GGUF',
    name: 'Gemma 4 E2B',
    params: 2,
    description: 'Google\'s latest, thinking mode + vision, MoE architecture',
    minRam: 4,
    type: 'vision' as const,
    org: 'google',
    isNew: true,
  },
  {
    id: 'unsloth/gemma-4-E4B-it-GGUF',
    name: 'Gemma 4 E4B',
    params: 4,
    description: 'Google\'s latest, stronger reasoning + vision',
    minRam: 6,
    type: 'vision' as const,
    org: 'google',
    isNew: true,
  },
  // --- Qwen 3.5 ---
  {
    id: 'unsloth/Qwen3.5-0.8B-GGUF',
    name: 'Qwen 3.5 0.8B',
    params: 0.8,
    description: 'Thinking mode, ultra-light, 262K context',
    minRam: 3,
    type: 'vision' as const,
    org: 'Qwen',
  },
  {
    id: 'unsloth/Qwen3.5-2B-GGUF',
    name: 'Qwen 3.5 2B',
    params: 2,
    description: 'Hybrid thinking + chat, 262K context',
    minRam: 4,
    type: 'vision' as const,
    org: 'Qwen',
  },
  {
    id: 'unsloth/Qwen3.5-9B-GGUF',
    name: 'Qwen 3.5 9B',
    params: 9,
    description: 'Best Qwen 3.5 quality, thinking mode, 262K context',
    minRam: 8,
    type: 'vision' as const,
    org: 'Qwen',
  },
  // --- Others ---
  {
    id: 'ggml-org/SmolLM3-3B-GGUF',
    name: 'SmolLM3 3B',
    params: 3,
    description: 'Purpose-built for constrained devices, 128K context',
    minRam: 6,
    type: 'text' as const,
    org: 'HuggingFaceTB',
  },
  {
    id: 'bartowski/Mistral-7B-Instruct-v0.3-GGUF',
    name: 'Mistral 7B',
    params: 7,
    description: 'Fast, reliable general purpose model',
    minRam: 6,
    type: 'text' as const,
    org: 'mistralai',
  },
  // --- Low-RAM only (≤ 6 GB) ---
  {
    id: 'ggml-org/SmolVLM2-500M-Video-Instruct-GGUF',
    name: 'SmolVLM2 500M',
    params: 0.5,
    description: 'Tiny vision + video model for constrained devices',
    minRam: 3,
    maxRam: 6,
    type: 'vision' as const,
    org: 'HuggingFaceTB',
  },
  {
    id: 'QuantFactory/SmolLM2-360M-Instruct-GGUF',
    name: 'SmolLM2 360M',
    params: 0.36,
    description: 'Ultra-light language model for low-RAM devices',
    minRam: 3,
    maxRam: 6,
    type: 'text' as const,
    org: 'HuggingFaceTB',
  },
  // --- Vision ---
  {
    id: 'ggml-org/SmolVLM-Instruct-GGUF',
    name: 'SmolVLM 2B',
    params: 2,
    description: 'Mobile-optimized vision-language model',
    minRam: 4,
    type: 'vision' as const,
    org: 'HuggingFaceTB',
  },
  {
    id: 'ggml-org/SmolVLM2-2.2B-Instruct-GGUF',
    name: 'SmolVLM2 2.2B',
    params: 2.2,
    description: 'Vision + video understanding',
    minRam: 4,
    type: 'vision' as const,
    org: 'HuggingFaceTB',
  },
];

// Trending model families — one best-fit per family is shown as "trending"
export const TRENDING_FAMILIES: Record<string, string[]> = {
  minicpm5: ['openbmb/MiniCPM5-2B-GGUF'],
  gemma4: ['unsloth/gemma-4-E2B-it-GGUF', 'unsloth/gemma-4-E4B-it-GGUF'],
  qwen35: ['unsloth/Qwen3.5-0.8B-GGUF', 'unsloth/Qwen3.5-2B-GGUF', 'unsloth/Qwen3.5-9B-GGUF'],
};
// Flat list used for badge rendering
export const TRENDING_MODEL_IDS = Object.values(TRENDING_FAMILIES).flat();

// Model organization filter options
export const MODEL_ORGS = [
  { key: 'openbmb', label: 'OpenBMB' },
  { key: 'Qwen', label: 'Qwen' },
  { key: 'meta-llama', label: 'Llama' },
  { key: 'google', label: 'Google' },
  { key: 'microsoft', label: 'Microsoft' },
  { key: 'mistralai', label: 'Mistral' },
  { key: 'deepseek-ai', label: 'DeepSeek' },
  { key: 'HuggingFaceTB', label: 'HuggingFace' },
  { key: 'nvidia', label: 'NVIDIA' },
];

// Quantization levels and their properties
export const QUANTIZATION_INFO: Record<string, {
  bitsPerWeight: number;
  quality: string;
  description: string;
  recommended: boolean;
}> = {
  'Q2_K': { bitsPerWeight: 2.625, quality: 'Low', description: 'Extreme compression, noticeable quality loss', recommended: false },
  'Q3_K_S': { bitsPerWeight: 3.4375, quality: 'Low-Medium', description: 'High compression, some quality loss', recommended: false },
  'Q3_K_M': { bitsPerWeight: 3.4375, quality: 'Medium', description: 'Good compression with acceptable quality', recommended: false },
  'Q4_0': { bitsPerWeight: 4, quality: 'Medium', description: 'Basic 4-bit quantization', recommended: false },
  'Q4_K_S': { bitsPerWeight: 4.5, quality: 'Medium-Good', description: 'Good balance of size and quality', recommended: true },
  'Q4_K_M': { bitsPerWeight: 4.5, quality: 'Good', description: 'Optimal for mobile - best balance', recommended: true },
  'Q5_K_S': { bitsPerWeight: 5.5, quality: 'Good-High', description: 'Higher quality, larger size', recommended: false },
  'Q5_K_M': { bitsPerWeight: 5.5, quality: 'High', description: 'Near original quality', recommended: false },
  'Q6_K': { bitsPerWeight: 6.5, quality: 'Very High', description: 'Minimal quality loss', recommended: false },
  'Q8_0': { bitsPerWeight: 8, quality: 'Excellent', description: 'Best quality, largest size', recommended: false },
};
