import type { ModelModality } from '@offgrid/models';

export interface LifecycleProjectionPort {
  refreshInventory(): Promise<unknown>;
  selectRoute(modality: ModelModality, routeId: string | null): Promise<void>;
}

type LifecycleProjectionRegistration = Omit<LifecycleProjectionPort, 'selectRoute'> & {
  selectRoute(modality: ModelModality, routeId: string | null): void | Promise<void>;
};

let port: LifecycleProjectionRegistration = {
  refreshInventory: async () => undefined,
  selectRoute: async () => undefined,
};

/** Composition-root registration. Lifecycle code depends inward on this port, not on LLMService. */
export function registerLifecycleProjectionPort(next: LifecycleProjectionRegistration): () => void {
  port = next;
  return () => {
    if (port === next) {
      port = {
        refreshInventory: async () => undefined,
        selectRoute: async () => undefined,
      };
    }
  };
}

export const lifecycleProjectionPort: LifecycleProjectionPort = {
  refreshInventory: () => port.refreshInventory(),
  selectRoute: (modality, routeId) => Promise.resolve(port.selectRoute(modality, routeId)),
};
