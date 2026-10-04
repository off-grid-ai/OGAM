import { create } from 'zustand';
import type { ChatStreamPreview } from '@offgrid/application';

/**
 * A reply currently generating on another device in the mesh.
 *
 * The shape is shared sync's own preview, not a copy of it: the projection that turns previews into
 * message rows is shared too, and it needs the same fields (ordering, completion) the Mac has.
 */
type RemoteChatStreamPreview = ChatStreamPreview;

interface RemoteChatStreamState {
  previews: readonly RemoteChatStreamPreview[];
  setPreviews: (previews: readonly RemoteChatStreamPreview[]) => void;
}

/**
 * Read-only projection of the replies generating on other devices.
 *
 * Private Pro's chat-stream service owns the state machine (frames, ordering, expiry) and pushes
 * the visible result here; the chat screen only renders it. Nothing in this store is durable - the
 * finished message arrives separately through the op-log, and these previews vanish.
 *
 * Free builds never write to it, so it stays empty and the chat screen behaves exactly as before.
 */
export const useRemoteChatStreamStore = create<RemoteChatStreamState>(set => ({
  previews: [],
  setPreviews: previews => set({ previews }),
}));
