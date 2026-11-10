/**
 * Handles to the two central stores for the modules UNDER them (persist adapters, vaults, the
 * document index). Those modules run as the stores' plumbing, so they cannot import the stores
 * without an import cycle; each store registers itself here the moment it is created instead.
 */
interface StoreLike { getState: () => any; setState: (updater: any) => void; persist?: any }

let chat: StoreLike | null = null;
let project: StoreLike | null = null;

export const registerChatStore = (s: StoreLike): void => { chat = s; };
export const registerProjectStore = (s: StoreLike): void => { project = s; };

/** The chat store (useChatStore). Throws if the store module has not been loaded yet. */
export function chatStoreRef(): StoreLike {
  if (!chat) throw new Error('The chat store is not created yet.');
  return chat;
}
/** The project store (useProjectStore). Throws if the store module has not been loaded yet. */
export function projectStoreRef(): StoreLike {
  if (!project) throw new Error('The project store is not created yet.');
  return project;
}
