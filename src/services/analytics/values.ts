/**
 * Pure value rules for analytics properties (docs/ANALYTICS.md, "Shared value rules").
 * No I/O here, so every rule is checked by plain unit tests.
 */

const GB = 1024 * 1024 * 1024;

/** Analytics never breaks the app: a failed boundary read or send is dropped. */
export const ignore = (): undefined => undefined;

/** Model ids that hold a file name the person chose (imports, recovered files). */
const CUSTOM_ID = /^(local|recovered)_/;
const HF_REPO_PREFIX = /^([\w.-]+)\/([\w.-]+)(?:\/|$)/;
const CATALOG_ID = /^[\w.-]+$/;

/**
 * Catalog ID, public Hugging Face `owner/repo`, or `custom`. Anything that may carry a file
 * name the person chose is `custom`.
 */
export function modelRef(id: string | null | undefined, repoId?: string): string {
  if (repoId && HF_REPO_PREFIX.test(repoId)) return repoId.split('/').slice(0, 2).join('/');
  if (!id || CUSTOM_ID.test(id)) return 'custom';
  const repo = HF_REPO_PREFIX.exec(id);
  if (repo) return `${repo[1]}/${repo[2]}`;
  return CATALOG_ID.test(id) ? id : 'custom';
}

export function sizeBucket(bytes: number | null | undefined): string | undefined {
  if (!bytes || bytes <= 0) return undefined;
  const gb = bytes / GB;
  if (gb < 1) return '<1GB';
  if (gb < 2) return '1-2GB';
  if (gb < 4) return '2-4GB';
  if (gb < 8) return '4-8GB';
  return '>8GB';
}

export function contextBucket(tokens: number | null | undefined): string | undefined {
  if (!tokens || tokens <= 0) return undefined;
  if (tokens < 2048) return '<2k';
  if (tokens < 8192) return '2-8k';
  if (tokens < 32768) return '8-32k';
  return '>32k';
}

/** Durations: whole milliseconds. */
export function ms(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
}

/** Rates and sizes: one decimal. */
export function oneDecimal(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : undefined;
}

export function bytesToGb(bytes: number | null | undefined): number | undefined {
  return typeof bytes === 'number' && Number.isFinite(bytes) ? oneDecimal(bytes / GB) : undefined;
}

/** Battery level (0..1) as a percentage rounded to 10. */
export function batteryPct(level: number | null | undefined): number | undefined {
  if (typeof level !== 'number' || level < 0) return undefined;
  return Math.round(level * 10) * 10;
}

const SAFE_CODE = /^[A-Za-z][\w.-]{0,47}$/;

/**
 * A fixed code from our own error classes, never a raw message: the error's `code`, else its
 * class name, else `error`.
 */
export function errorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && SAFE_CODE.test(code)) return code;
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && name !== 'Error' && SAFE_CODE.test(name)) return name;
  }
  return 'error';
}

/** `en-GB` → `en`. */
export function languageOnly(locale: string | undefined): string {
  return (locale ?? '').split(/[-_]/)[0].toLowerCase() || 'unknown';
}

/** Store builds call themselves `x.y.z`; anything with a suffix is a beta. */
export function releaseChannel(version: string): 'stable' | 'nightly' {
  return /-/.test(version) ? 'nightly' : 'stable';
}

/** `.PDF` / `notes.pdf` → `pdf`. Never the name. */
export function fileExtension(name: string | undefined): string | undefined {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name ?? '');
  return match ? match[1].toLowerCase() : undefined;
}

/** Which `feature_used` value a built-in tool counts as. */
export function toolFeature(toolName: string): 'web_search' | 'clipboard' | 'browser_action' | 'tools' {
  if (toolName === 'web_search' || toolName === 'read_url') return 'web_search';
  if (/clipboard/i.test(toolName)) return 'clipboard';
  if (/^browser/i.test(toolName)) return 'browser_action';
  return 'tools';
}

/** llama.cpp/LiteRT backend settings → `cpu` / `gpu` / `npu`. */
export function computeBackend(setting: string | undefined): 'cpu' | 'gpu' | 'npu' {
  if (setting === 'htp' || setting === 'npu' || setting === 'qnn') return 'npu';
  if (setting === 'metal' || setting === 'opencl' || setting === 'gpu' || setting === 'coreml') return 'gpu';
  return 'cpu';
}
