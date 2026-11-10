/**
 * The modules under the chat/project stores (persist adapters, vaults, the document index) reach
 * the stores through storeRefs; the app registers the stores at start-up. A suite that loads or
 * jest.mocks a store module registers the same object here, so those modules find it.
 */
export function registerStoreRefs(): void {
  const { registerChatStore, registerProjectStore } = require('../../src/stores/storeRefs');
  try { registerChatStore(require('../../src/stores/chatStore').useChatStore); } catch { /* this suite has no chat store */ }
  try { registerProjectStore(require('../../src/stores/projectStore').useProjectStore); } catch { /* this suite has no project store */ }
}
