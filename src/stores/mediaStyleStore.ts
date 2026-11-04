import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MediaStyleKind } from '@offgrid/models';
import { createHydrationGatedStorage } from '../utils/hydrationGatedStorage';

type ChatStyles = Partial<Record<MediaStyleKind, string>>;

interface MediaStyleState {
  /** The style each chat last chose, per kind: the next picture or clip in that chat uses it. */
  byChat: Record<string, ChatStyles>;
  setStyle: (conversationId: string, kind: MediaStyleKind, styleId: string | null) => void;
  /** Forget a deleted chat's choice. */
  forgetChat: (conversationId: string) => void;
}

type PersistedMediaStyleState = Pick<MediaStyleState, 'byChat'>;
const mediaStyleStorage = createHydrationGatedStorage<PersistedMediaStyleState>();

export const useMediaStyleStore = create<MediaStyleState>()(
  persist(
    set => ({
      byChat: {},
      setStyle: (conversationId, kind, styleId) =>
        set(state => {
          const chat = { ...state.byChat[conversationId] };
          if (styleId) chat[kind] = styleId;
          else delete chat[kind];
          return { byChat: { ...state.byChat, [conversationId]: chat } };
        }),
      forgetChat: conversationId =>
        set(state => {
          const { [conversationId]: _gone, ...rest } = state.byChat;
          return { byChat: rest };
        }),
    }),
    {
      name: 'offgrid-media-styles',
      storage: mediaStyleStorage.storage,
      onRehydrateStorage: mediaStyleStorage.onRehydrateStorage(),
      merge: mediaStyleStorage.merge<MediaStyleState>(),
      partialize: (state): PersistedMediaStyleState => ({ byChat: state.byChat }),
    },
  ),
);
mediaStyleStorage.attach(useMediaStyleStore);

/** Where a chat with no id yet (before its first message) keeps the style it chose. */
export const NEW_CHAT_STYLE_KEY = 'new-chat';

/** The style a chat uses for its next picture or clip, if it chose one. Only the chat's own choice: a draft from
 *  before the chat had an id moved to it when it got one (adoptDraftStyles), so no other chat can take it. */
export function chatStyleId(conversationId: string, kind: MediaStyleKind): string | undefined {
  return useMediaStyleStore.getState().byChat[conversationId]?.[kind];
}

/** A new chat just got its id: the picture and clip styles chosen before that move to it, and the draft is empty. */
export function adoptDraftStyles(conversationId: string): void {
  const state = useMediaStyleStore.getState();
  const draft = state.byChat[NEW_CHAT_STYLE_KEY];
  if (!draft) return;
  for (const kind of Object.keys(draft) as MediaStyleKind[]) {
    if (draft[kind]) state.setStyle(conversationId, kind, draft[kind] as string);
    state.setStyle(NEW_CHAT_STYLE_KEY, kind, null);
  }
}
