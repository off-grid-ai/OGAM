import type { TextStreamTransport } from './types';
import logger from '../../../utils/logger';

/** I/O lookup only. Shared LLMService owns models, capabilities, selection, and routes. */
class RemoteTextTransportRegistry {
  private readonly transports = new Map<string, TextStreamTransport>();

  register(serverId: string, transport: TextStreamTransport): void {
    this.transports.set(serverId, transport);
    logger.log('[RemoteTextTransportRegistry] Registered transport:', serverId);
  }

  unregister(serverId: string): void {
    this.transports.delete(serverId);
  }

  get(serverId: string): TextStreamTransport | undefined {
    return this.transports.get(serverId);
  }

  has(serverId: string): boolean {
    return this.transports.has(serverId);
  }

  ids(): string[] {
    return [...this.transports.keys()];
  }

  clear(): void {
    this.transports.clear();
  }
}

export const remoteTextTransportRegistry = new RemoteTextTransportRegistry();
