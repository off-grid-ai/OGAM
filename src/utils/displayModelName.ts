const MODEL_FILE_EXT = /\.(gguf|bin|safetensors|task|litertlm|pte)$/i;

/**
 * Human-readable label for a remote model. Some gateways report the model id as a
 * full file path (e.g. "/Users/admin/.offgrid/models/Qwen3.5-9B-Q4_K_M.gguf"),
 * which is unreadable in the picker. Show the basename without the extension while
 * keeping the raw id for loading.
 *
 * Only basename-strip when the id actually LOOKS like a filesystem path — an
 * absolute POSIX path ("/…"), a Windows path ("C:\…" / "C:/…"), or any string
 * that ends in a known model file extension. A namespace-style slug ("org/model",
 * "meta-llama/Llama-3.1-8B") is NOT a path: stripping its prefix would drop the
 * meaningful namespace and could collapse distinct models to the same label, so
 * it's returned unchanged.
 */
export function displayModelName(id: string): string {
  if (id.startsWith('remote-vision:')) {
    const modelSeparator = id.indexOf(':', 'remote-vision:'.length);
    if (modelSeparator !== -1) {
      try {
        return decodeURIComponent(id.slice(modelSeparator + 1));
      } catch {
        // Keep the stable raw id when a third-party gateway sends bad encoding.
      }
    }
  }
  const looksLikePath =
    id.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(id) ||
    id.includes('\\') ||
    MODEL_FILE_EXT.test(id);
  const base = looksLikePath ? id.split(/[\\/]/).pop() || id : id;
  return base.replace(MODEL_FILE_EXT, '');
}
