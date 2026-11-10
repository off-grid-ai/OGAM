import type { Conversation } from '../types';

/** How the Chats list groups conversations, chosen in its menu (like Claude's chat list). */
export type ChatGroupBy = 'date' | 'project' | 'none';
/** Which time a chat is ordered and dated by. */
export type ChatSortBy = 'updated' | 'created';

export const DEFAULT_CHAT_GROUP_BY: ChatGroupBy = 'date';
export const DEFAULT_CHAT_SORT_BY: ChatSortBy = 'updated';

export interface ChatSection {
  /** Stable across renders, so a folded section stays folded. */
  key: string;
  /** The header; empty for the single section of an ungrouped list. */
  title: string;
  data: Conversation[];
}

function stamp(conversation: Conversation, sortBy: ChatSortBy): number {
  const parsed = Date.parse(sortBy === 'created' ? conversation.createdAt : conversation.updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Newest first, by the chosen time. */
export function sortChats(conversations: readonly Conversation[], sortBy: ChatSortBy): Conversation[] {
  return [...conversations].sort((a, b) => stamp(b, sortBy) - stamp(a, sortBy));
}

function startOfLocalDay(time: number): number {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today", "Yesterday", then the day itself: "Nov 5", or "Nov 5, 2025" in another year. */
function dayTitle(dayStart: number, now: number): string {
  const today = startOfLocalDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayStart === today) return 'Today';
  if (dayStart === yesterday.getTime()) return 'Yesterday';
  const day = new Date(dayStart);
  const label = `${MONTHS[day.getMonth()]} ${day.getDate()}`;
  return day.getFullYear() === new Date(now).getFullYear() ? label : `${label}, ${day.getFullYear()}`;
}

/** A chat's section key and title; null for a chat outside any project (or a deleted one). */
function sectionHeading(
  conversation: Conversation,
  groupBy: 'date' | 'project',
  sortBy: ChatSortBy,
  projectName: (projectId: string) => string | undefined,
  now: number,
): { key: string; title: string } | null {
  if (groupBy === 'date') {
    const day = startOfLocalDay(stamp(conversation, sortBy));
    return { key: `day:${day}`, title: dayTitle(day, now) };
  }
  const name = conversation.projectId ? projectName(conversation.projectId) : undefined;
  return conversation.projectId && name ? { key: `project:${conversation.projectId}`, title: name } : null;
}

/**
 * The Chats list's sections. Sorts first, so every section is newest first and sections follow the
 * newest chat in each: by date, a section per local calendar day; by project, a section per project
 * in order of its latest chat, with chats outside any project last; ungrouped, one untitled section.
 */
export function groupChats(
  conversations: readonly Conversation[],
  options: {
    groupBy: ChatGroupBy;
    sortBy: ChatSortBy;
    projectName: (projectId: string) => string | undefined;
    now?: number;
  },
): ChatSection[] {
  const sorted = sortChats(conversations, options.sortBy);
  if (options.groupBy === 'none') return sorted.length ? [{ key: 'all', title: '', data: sorted }] : [];

  const now = options.now ?? Date.now();
  const sections = new Map<string, ChatSection>();
  const outside: Conversation[] = [];
  for (const conversation of sorted) {
    const heading = sectionHeading(conversation, options.groupBy, options.sortBy, options.projectName, now);
    if (!heading) {
      outside.push(conversation);
      continue;
    }
    const { key, title } = heading;
    const section = sections.get(key);
    if (section) section.data.push(conversation);
    else sections.set(key, { key, title, data: [conversation] });
  }
  const result = [...sections.values()];
  if (outside.length) result.push({ key: 'project:none', title: 'No project', data: outside });
  return result;
}
