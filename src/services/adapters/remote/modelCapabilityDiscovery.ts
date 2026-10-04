/** Mobile raw HTTP adapter for Shared remote capability discovery(). */

import {
  isGenerativeRemoteModel,
  type RemoteCapabilityProbeEvidence,
  type RemoteCapabilityProbeRequest,
  type RemoteModelCapabilityInfo,
} from '@offgrid/models';
import type { RemoteCapabilityDiscoveryApplicationService } from '@offgrid/models';
import logger from '../../../utils/logger';

export type RemoteModelInfo = RemoteModelCapabilityInfo;

async function execute(
  request: RemoteCapabilityProbeRequest,
): Promise<RemoteCapabilityProbeEvidence> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: { ...request.headers },
      body: request.body,
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false };
    return request.response === 'text'
      ? { ok: true, text: await response.text() }
      : { ok: true, payload: await response.json() };
  } catch (error) {
    logger.warn(
      '[remote-capability] probe unavailable:',
      request.kind,
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Raw HTTP probe as the discovery port. */
export function mobileRemoteCapabilityPorts(): ConstructorParameters<
  typeof RemoteCapabilityDiscoveryApplicationService
>[0] {
  return { execute };
}

export function isGenerativeModel(modelId: string): boolean {
  return isGenerativeRemoteModel(modelId);
}
