/** Mobile transport adapter for Shared remote-provider discovery. */

import { readOffGridDesktopModelEvidence } from './offGridDesktopModels';
import {
  REMOTE_FETCH_REDIRECT_POLICY,
  displayRemoteModelName,
  remoteAuthorizationHeaders,
  type RemoteProviderProbe,
  type RemoteProviderProbeEvidence,
} from '@offgrid/models';
import type { RemoteProviderDiscoveryApplicationService } from '@offgrid/models';

export const displayModelName = displayRemoteModelName;

/** Typed adapter failure kept distinct from a successful empty remote catalog. */
export class RemoteModelDiscoveryError extends Error {
  readonly kind = 'remote-model-discovery' as const;

  constructor(message: string) {
    super(message);
    this.name = 'RemoteModelDiscoveryError';
  }
}

async function probeRemoteProvider(
  request: RemoteProviderProbe,
  authorizationHeaders: Readonly<Record<string, string>>,
): Promise<RemoteProviderProbeEvidence> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', ...authorizationHeaders },
      redirect: REMOTE_FETCH_REDIRECT_POLICY,
    });
    return {
      ok: response.ok,
      status: response.status,
      headers: {
        server:
          typeof response.headers?.get === 'function'
            ? response.headers.get('server') ?? ''
            : '',
      },
      payload: await response.json().catch(() => undefined),
      ...(!response.ok ? { error: `Server returned ${response.status}` } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Transport, Desktop evidence, and capability mapping ports. Shared owns discovery. */
export function mobileRemoteProviderDiscoveryPorts(
  mapTextModels: ConstructorParameters<
    typeof RemoteProviderDiscoveryApplicationService
  >[0]['mapTextModels'],
): ConstructorParameters<typeof RemoteProviderDiscoveryApplicationService>[0] {
  return {
    probe: probeRemoteProvider,
    readDesktop: (input, timeoutMs) =>
      readOffGridDesktopModelEvidence(
        {
          endpoint: input.endpoint,
          apiKey: input.apiKey,
        },
        timeoutMs,
      ),
    mapTextModels,
    authorizationHeaders: remoteAuthorizationHeaders,
    now: Date.now,
    timestamp: () => new Date().toISOString(),
  };
}
