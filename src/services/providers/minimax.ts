/** MiniMax remote provider presets.
 *
 * MiniMax exposes OpenAI-compatible and Anthropic-compatible transports in
 * separate regional endpoints. Keeping the endpoints and model defaults in a
 * single registry lets callers present a provider choice without duplicating
 * routing facts throughout the remote-server UI.
 */
export const MINIMAX_PROVIDER = 'MiniMax' as const;

export const MINIMAX_ENDPOINTS = {
  global: {
    openai: 'https://api.minimax.io/v1',
    anthropic: 'https://api.minimax.io/anthropic',
  },
  china: {
    openai: 'https://api.minimaxi.com/v1',
    anthropic: 'https://api.minimaxi.com/anthropic',
  },
} as const;

export const MINIMAX_MODELS = [
  { id: 'MiniMax-M3.1-Flash', contextWindow: 1_000_000 },
  { id: 'MiniMax-M3', contextWindow: 1_000_000 },
] as const;

export const MINIMAX_DEFAULT_MODEL = MINIMAX_MODELS[0].id;

export type MiniMaxRegion = keyof typeof MINIMAX_ENDPOINTS;

export const MINIMAX_OPENROUTER_MODELS = [
  'minimax/minimax-m3.1-flash:free',
  'minimax/minimax-m3',
] as const;

/** Filter ordinary text choices only; saved/custom model IDs are never rewritten. */
export function currentMiniMaxTextModels<T extends { id: string }>(
  endpoint: string,
  models: T[],
): T[] {
  const direct = isMiniMaxEndpoint(endpoint);
  let gateway = false;
  try {
    gateway = new URL(endpoint).hostname === 'openrouter.ai';
  } catch {
    return models;
  }
  if (!direct && !gateway) return models;
  const ids: readonly string[] = direct
    ? MINIMAX_MODELS.map(model => model.id)
    : MINIMAX_OPENROUTER_MODELS;
  const prefix = direct ? 'MiniMax-' : 'minimax/';
  const current = models.filter(model => ids.includes(model.id));
  current.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  let next = 0;
  return models
    .filter(model => !model.id.startsWith(prefix) || ids.includes(model.id))
    .map(model => ids.includes(model.id) ? current[next++] : model);
}

export function isMiniMaxEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    // Only recognize the transport implemented by the remote provider. Other
    // paths (including saved Anthropic endpoints) remain explicit custom routes.
    return url.protocol === 'https:' &&
      (url.hostname === 'api.minimax.io' || url.hostname === 'api.minimaxi.com') &&
      ['', '/', '/v1', '/v1/'].includes(url.pathname);
  } catch {
    return false;
  }
}

export function miniMaxRegion(endpoint: string): MiniMaxRegion | null {
  try {
    const hostname = new URL(endpoint).hostname;
    if (hostname === 'api.minimax.io') return 'global';
    if (hostname === 'api.minimaxi.com') return 'china';
  } catch {
    // Invalid endpoints are handled by the editor's URL validation.
  }
  return null;
}
