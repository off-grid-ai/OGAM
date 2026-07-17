import { useRemoteServerStore } from '../stores/remoteServerStore';
import { providerRegistry } from './providers/registry';

/** Clear the remote text/image selection and route subsequent work locally. */
export function clearActiveRemoteModelSelection(): void {
  const store = useRemoteServerStore.getState();
  store.setActiveServerId(null);
  store.setActiveRemoteTextModelId(null);
  store.setActiveRemoteImageModelId(null);
  providerRegistry.setActiveProvider('local');
}
