/**
 * Where to offload a transcription: the paired Mac's LAN gateway base URL + the bearer token to reach
 * it. When a Mac grants this phone its tools over the mesh, the phone holds a "companion" MCP server
 * carrying the Mac's /mcp URL and a token derived from the pairing secret - the SAME token the Mac's
 * gateway validates. We reuse that trust for the audio route: strip /mcp for the gateway base, POST the
 * WAV to /v1/audio/transcriptions with that token. No new pairing, no second credential.
 *
 * Core + pure: the decision (which companion, is it reachable) is a pure function; the concrete pro
 * stores are read by a provider the pro layer registers - core never imports pro.
 */

export interface CompanionServerView {
  id: string
  url: string
  authHeaderValue?: string
  grantedByDeviceId?: string
}

export interface MacOffloadTarget {
  /** e.g. http://192.168.1.18:7878 */
  baseUrl: string
  /** Bearer token the Mac gateway validates (per-device action token). */
  token: string
}

const MCP_SUFFIX = /\/mcp\/?$/

/** Pick the reachable, Mac-granted companion server and turn it into a gateway target. */
export function resolveMacOffloadTarget(
  servers: readonly CompanionServerView[],
  isConnected: (serverId: string) => boolean,
  macDeviceIds: ReadonlySet<string>
): MacOffloadTarget | null {
  for (const server of servers) {
    if (!server.grantedByDeviceId || !macDeviceIds.has(server.grantedByDeviceId)) continue
    if (!server.authHeaderValue) continue
    if (!MCP_SUFFIX.test(server.url)) continue
    if (!isConnected(server.id)) continue
    return { baseUrl: server.url.replace(MCP_SUFFIX, ''), token: server.authHeaderValue }
  }
  return null
}

/** The transcription endpoint for a resolved gateway base. */
export function transcriptionEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/v1/audio/transcriptions`
}

// ─── Port: pro registers the concrete resolution; core reads through this ─────
export type MacOffloadTargetProvider = () => MacOffloadTarget | null

let provider: MacOffloadTargetProvider | null = null

export function registerMacOffloadTargetProvider(
  next: MacOffloadTargetProvider | null
): () => void {
  provider = next
  return () => {
    if (provider === next) provider = null
  }
}

/** The current Mac offload target, or null when no Mac is granted/reachable (phone-only). */
export function currentMacOffloadTarget(): MacOffloadTarget | null {
  return provider ? provider() : null
}
