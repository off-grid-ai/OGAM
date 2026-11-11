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

export interface MergeChoice {
  /** The chat whose settings (agent, project, instructions, tools) the merged chat keeps. Default: the longest chat. */
  baseId?: string;
  /** Agent for the merged chat: an id, null for no agent, or undefined to keep the base chat's. */
  agentId?: string | null;
}

/** One chat made from a set of twins. */
export function mergeGroup(group: Conversation[], choice: MergeChoice = {}): Conversation {
  const longest = [...group].sort((a, b) => b.messages.length - a.messages.length || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const base = group.find((c) => c.id === choice.baseId) ?? longest[0];
  const messages = [...base.messages];
  for (const other of longest) if (other.id !== base.id) for (const m of other.messages) if (!messages.some((x) => sameMessage(x, m))) messages.push(m);
  messages.sort((a, b) => a.timestamp - b.timestamp);
  const newest = Math.max(...group.map((c) => Date.parse(c.updatedAt) || 0));
  const merged: Conversation = {
    ...base, title: baseTitle(base.title), messages,
    isPinned: group.some((c) => c.isPinned) || undefined,
    createdAt: group.map((c) => c.createdAt).sort()[0] ?? base.createdAt,
    updatedAt: new Date(newest || Date.now()).toISOString(),
  };
  if (choice.agentId !== undefined) merged.agentId = choice.agentId ?? undefined;
  return merged;
}

/** What the person needs to see for one chat in a set: how long it is, when it was last used, which agent and project. */
export interface ChatSummary { id: string; messages: number; updated: string; agent: string; project: string; preview: string }

export function summarizeChat(c: Conversation, names: { agent: (id?: string | null) => string; project: (id?: string | null) => string }): ChatSummary {
  const last = [...c.messages].reverse().find((m) => m.role === 'user' || m.role === 'assistant');
  return {
    id: c.id, messages: c.messages.length, updated: c.updatedAt,
    agent: names.agent(c.agentId), project: names.project(c.projectId),
    preview: (last?.content ?? '').replace(/\s+/g, ' ').slice(0, 90),
  };
}

/** How many messages the merged chat will have (the union, without repeats). */
export function mergedMessageCount(group: Conversation[], choice: MergeChoice = {}): number {
  return mergeGroup(group, choice).messages.length;
}

/** The chat list with every set of twins merged. `merged` counts the chats that went away. */
/** Merges every set (or only `only`, one set) with the given choices keyed by the set's first chat id. */
export function mergeAllDuplicates(chats: Conversation[], opts: { only?: string[]; choices?: Record<string, MergeChoice> } = {}): { chats: Conversation[]; merged: number } {
  const groups = duplicateGroups(chats).filter((g) => !opts.only || g.some((c) => opts.only!.includes(c.id)));
  if (!groups.length) return { chats, merged: 0 };
  const gone = new Set(groups.flat().map((c) => c.id));
  const made = groups.map((g) => mergeGroup(g, opts.choices?.[g[0].id]));
  const kept = chats.filter((c) => !gone.has(c.id));
  return { chats: [...made, ...kept], merged: groups.reduce((n, g) => n + g.length - 1, 0) };
}
