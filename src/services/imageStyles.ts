/**
 * Image styles: a look chosen once (anime, realistic, cartoon...) that every picture gets. The
 * style's words go after the prompt (after enhancement, so the model's rewrite cannot drop
 * them), and its negative words keep other looks out.
 */
export interface ImageStyle { id: string; name: string; prompt: string; negative: string }

export const IMAGE_STYLES: ImageStyle[] = [
  { id: 'none', name: 'None', prompt: '', negative: '' },
  { id: 'realistic', name: 'Realistic', prompt: 'photorealistic, natural lighting, detailed, sharp focus, 35mm photo', negative: 'cartoon, anime, illustration, painting, drawing, 3d render' },
  { id: 'anime', name: 'Anime', prompt: 'anime style, cel shading, clean line art, vibrant colors, detailed eyes', negative: 'photo, photorealistic, 3d render, realistic' },
  { id: 'cartoon', name: 'Cartoon', prompt: 'cartoon style, bold outlines, flat bright colors, simple shapes', negative: 'photo, photorealistic, realistic, gritty' },
  { id: 'pixar', name: '3D animated', prompt: '3d animated film style, soft lighting, expressive characters, smooth render', negative: 'photo, flat, sketch, anime' },
  { id: 'watercolor', name: 'Watercolor', prompt: 'watercolor painting, soft washes, paper texture, gentle colors', negative: 'photo, 3d render, sharp digital lines' },
  { id: 'oil', name: 'Oil painting', prompt: 'oil painting, visible brush strokes, rich colors, classic fine art', negative: 'photo, 3d render, cartoon' },
  { id: 'sketch', name: 'Pencil sketch', prompt: 'pencil sketch, graphite, hand drawn, cross hatching, black and white', negative: 'color, photo, 3d render' },
  { id: 'comic', name: 'Comic book', prompt: 'comic book art, ink lines, halftone shading, dynamic composition', negative: 'photo, photorealistic, blurry' },
  { id: 'pixel', name: 'Pixel art', prompt: 'pixel art, 16-bit, crisp pixels, limited palette', negative: 'photo, smooth gradients, blurry, 3d render' },
  { id: 'cinematic', name: 'Cinematic', prompt: 'cinematic film still, dramatic lighting, shallow depth of field, color graded', negative: 'cartoon, drawing, flat lighting' },
  { id: 'fantasy', name: 'Fantasy art', prompt: 'epic fantasy art, magical atmosphere, detailed, concept art', negative: 'photo, plain background, low detail' },
];

export const imageStyleById = (id?: string): ImageStyle => IMAGE_STYLES.find((s) => s.id === id) ?? IMAGE_STYLES[0];

/**
 * The prompt and negative prompt with the chosen style added. The style comes FIRST: CLIP-based models
 * (Stable Diffusion 1.5 and XL) read only about 75 tokens and cut the rest, and a long enhanced prompt
 * would push words placed after it out of range.
 */
export function applyImageStyle(prompt: string, negative: string, styleId?: string): { prompt: string; negative: string } {
  const style = imageStyleById(styleId);
  const join = (a: string, b: string) => [a.trim(), b.trim()].filter(Boolean).join(', ');
  return { prompt: join(style.prompt, prompt.trim()), negative: join(negative, style.negative) };
}
