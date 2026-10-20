import type { ModelFile } from '../../types';

export type SizeLabel = 'Smaller' | 'Recommended' | 'Best';

/**
 * A model's downloads in three words instead of quantization names. `files` are the files this
 * phone can run, best first for this phone (the recommended quant leads). Smaller is the smallest
 * file below the recommended one, Best the largest above it; either is left out when there is none.
 */
export function sizeChoices(files: readonly ModelFile[]): { file: ModelFile; label: SizeLabel }[] {
  const recommended = files[0];
  if (!recommended) return [];
  const smaller = files.filter(f => f.size < recommended.size).sort((a, b) => a.size - b.size)[0];
  const best = files.filter(f => f.size > recommended.size).sort((a, b) => b.size - a.size)[0];
  return [
    ...(smaller ? [{ file: smaller, label: 'Smaller' as const }] : []),
    { file: recommended, label: 'Recommended' as const },
    ...(best ? [{ file: best, label: 'Best' as const }] : []),
  ];
}
