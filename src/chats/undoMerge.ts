/**
 * Merging chats takes effect at once, then waits a few seconds for an Undo that puts every original chat back exactly as it
 * was. The same short window as deleting a chat.
 */
import { useChatStore } from '../stores';
import { duplicateGroups, mergeAllDuplicates, type MergeChoice } from './mergeDuplicates';
import type { Conversation } from '../types';

export const UNDO_MERGE_MS = 8000;

interface Pending { originals: Conversation[]; merged: number; timer: ReturnType<typeof setTimeout> }
let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** How many chats the last merge removed, while it can still be undone. */
export const undoableMerge = (): number | null => (pending ? pending.merged : null);
export const subscribeUndoMerge = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

function forget() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending = null;
  emit();
}

/** Merges the sets (all, or only those containing `only` ids) and keeps the originals for a few seconds. Returns chats removed. */
export function mergeWithUndo(opts: { only?: string[]; choices?: Record<string, MergeChoice> } = {}): number {
  const before = useChatStore.getState().conversations;
  const result = mergeAllDuplicates(before, opts);
  if (!result.merged) return 0;
  forget();
  const groups = duplicateGroups(before).filter((g) => !opts.only || g.some((c) => opts.only!.includes(c.id)));
  const originals = groups.flat();
  useChatStore.setState({ conversations: result.chats });
  pending = { originals, merged: result.merged, timer: setTimeout(forget, UNDO_MERGE_MS) };
  emit();
  return result.merged;
}

export function undoMerge(): void {
  if (!pending) return;
  const { originals } = pending;
  forget();
  const ids = new Set(originals.map((c) => c.id));
  // The merged chat keeps the id of the chat it was based on: take it out, then put every original back.
  useChatStore.setState((s) => ({ conversations: [...s.conversations.filter((c) => !ids.has(c.id)), ...originals] }));
}
