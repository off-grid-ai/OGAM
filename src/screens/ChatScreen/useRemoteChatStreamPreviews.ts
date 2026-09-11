import { useMemo } from 'react';
import { chatStreamPreviewRows } from '@offgrid/application';
import { useRemoteChatStreamStore } from '../../stores/remoteChatStreamStore';
import type { RemoteStreamItem } from './types';

/**
 * The replies paired devices are generating in THIS conversation, right now.
 *
 * The narrowing rule - which previews belong to the open conversation, in what order, under what
 * stable id - is shared (`chatStreamPreviewRows`), so the Mac appends exactly the same rows. This
 * hook only subscribes to the store. Empty in free builds, and whenever no peer is mid-reply.
 */
export function useRemoteChatStreamPreviews(
  activeConversationId: string | null,
): readonly RemoteStreamItem[] {
  const previews = useRemoteChatStreamStore(state => state.previews);
  return useMemo(
    () => chatStreamPreviewRows(previews, activeConversationId),
    [previews, activeConversationId],
  );
}
