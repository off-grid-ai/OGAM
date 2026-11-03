/**
 * Two phones that each made a chat with the same title (or a sync that kept both sides of a change) leave twins in the list.
 * This finds chats that share a title and merges each set into one: the longest chat is the base, and every message the
 * others have that the base lacks is added, in time order. Pure, so it is tested without a device.
 */
import type { Conversation, Message } from '../types';

/** Titles that many unrelated chats share: never treated as duplicates. */
const GENERIC = new Set(['new chat', 'conversation', 'untitled', 'chat', '']);
const SUFFIX = /\s*\((sync conflict|edited after deletion)\)\s*$/i;

export const baseTitle = (title: string) => title.replace(SUFFIX, '').trim();
const key = (title: string) => baseTitle(title).toLowerCase();
const mergeable = (c: Conversation) => !c.pinVerifier && !c.protectedBlob && !c.isPrivate && !c.isArchived && !GENERIC.has(key(c.title));
const sameMessage = (a: Message, b: Message) => a.role === b.role && a.content === b.content;

/** Sets of two or more chats that share a title. */
export function duplicateGroups(chats: Conversation[]): Conversation[][] {
  const byTitle = new Map<string, Conversation[]>();
  for (const c of chats.filter(mergeable)) byTitle.set(key(c.title), [...(byTitle.get(key(c.title)) ?? []), c]);
  return [...byTitle.values()].filter((g) => g.length > 1);
}

/** One chat made from a set of twins. */
export function mergeGroup(group: Conversation[]): Conversation {
  const ordered = [...group].sort((a, b) => b.messages.length - a.messages.length || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const [base, ...others] = ordered;
  const messages = [...base.messages];
  for (const other of others) for (const m of other.messages) if (!messages.some((x) => sameMessage(x, m))) messages.push(m);
  messages.sort((a, b) => a.timestamp - b.timestamp);
  const newest = Math.max(...group.map((c) => Date.parse(c.updatedAt) || 0));
  return {
    ...base, title: baseTitle(base.title), messages,
    isPinned: group.some((c) => c.isPinned) || undefined,
    createdAt: group.map((c) => c.createdAt).sort()[0] ?? base.createdAt,
    updatedAt: new Date(newest || Date.now()).toISOString(),
  };
}

/** The chat list with every set of twins merged. `merged` counts the chats that went away. */
export function mergeAllDuplicates(chats: Conversation[]): { chats: Conversation[]; merged: number } {
  const groups = duplicateGroups(chats);
  if (!groups.length) return { chats, merged: 0 };
  const gone = new Set(groups.flat().map((c) => c.id));
  const made = groups.map(mergeGroup);
  const kept = chats.filter((c) => !gone.has(c.id));
  return { chats: [...made, ...kept], merged: groups.reduce((n, g) => n + g.length - 1, 0) };
}
