/** Mobile device and HTTP adapter for Shared LAN remote-server discovery(). */

import { getIpAddress, isEmulator } from 'react-native-device-info';
import {
  type RemoteLanProbeEvidence,
  type RemoteLanServer,
} from '@offgrid/models';
import type { RemoteLanDiscoveryApplicationService } from '@offgrid/models';

export type DiscoveredServer = RemoteLanServer;

async function probe(
  url: string,
  timeoutMs: number,
): Promise<RemoteLanProbeEvidence> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal }); // NOSONAR — LAN-only probe
    return { reachable: true, status: response.status };
  } catch {
    return { reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Device identity and HTTP probe ports. Shared owns the scan. */
export function mobileLanDiscoveryPorts(): ConstructorParameters<
  typeof RemoteLanDiscoveryApplicationService
>[0] {
  return { isEmulator, ipAddress: getIpAddress, probe };
}
