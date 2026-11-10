import { groupChats, sortChats } from '../../../src/utils/chatGrouping';
import type { Conversation } from '../../../src/types';

// Local times, so the day boundaries are the phone's own.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
const NOW = new Date(2026, 10, 9, 15).getTime(); // 9 Nov 2026, 3 pm

const chat = (id: string, updatedAt: string, extra: Partial<Conversation> = {}): Conversation =>
  ({ id, title: id, messages: [], createdAt: updatedAt, updatedAt, ...extra } as Conversation);

const projects: Record<string, string> = { p1: 'Garden', p2: 'Taxes' };
const projectName = (id: string) => projects[id];
const shape = (sections: ReturnType<typeof groupChats>) => sections.map(s => [s.title, s.data.map(c => c.id)]);

describe('Chats grouping', () => {
  const chats = [
    chat('older', at(2025, 12, 31)),
    chat('nov5', at(2026, 11, 5), { projectId: 'p2' }),
    chat('today-am', at(2026, 11, 9, 8), { projectId: 'p1' }),
    chat('yesterday-late', at(2026, 11, 8, 23)),
    chat('today-pm', at(2026, 11, 9, 14)),
    chat('gone-project', at(2026, 11, 6), { projectId: 'deleted' }),
  ];

  it('by date: Today, Yesterday, then each day, newest first; another year names its year', () => {
    expect(shape(groupChats(chats, { groupBy: 'date', sortBy: 'updated', projectName, now: NOW }))).toEqual([
      ['Today', ['today-pm', 'today-am']],
      ['Yesterday', ['yesterday-late']],
      ['Nov 6', ['gone-project']],
      ['Nov 5', ['nov5']],
      ['Dec 31, 2025', ['older']],
    ]);
  });

  it('by project: projects in order of their latest chat, chats outside any project (or a deleted one) last', () => {
    expect(shape(groupChats(chats, { groupBy: 'project', sortBy: 'updated', projectName, now: NOW }))).toEqual([
      ['Garden', ['today-am']],
      ['Taxes', ['nov5']],
      ['No project', ['today-pm', 'yesterday-late', 'gone-project', 'older']],
    ]);
  });

  it('ungrouped: one untitled section; an empty list has no sections', () => {
    expect(shape(groupChats(chats, { groupBy: 'none', sortBy: 'updated', projectName, now: NOW }))).toEqual([
      ['', ['today-pm', 'today-am', 'yesterday-late', 'gone-project', 'nov5', 'older']],
    ]);
    expect(groupChats([], { groupBy: 'none', sortBy: 'updated', projectName })).toEqual([]);
  });

  it('sorted by created: an old chat used today stays on the day it was started', () => {
    const revived = chat('revived', at(2026, 11, 9, 10), { createdAt: at(2026, 11, 1) });
    expect(shape(groupChats([revived], { groupBy: 'date', sortBy: 'created', projectName, now: NOW }))).toEqual([
      ['Nov 1', ['revived']],
    ]);
    expect(sortChats([chat('a', at(2026, 11, 2)), revived], 'created').map(c => c.id)).toEqual(['a', 'revived']);
  });

  it('section keys stay the same across renders, so a folded section stays folded', () => {
    const first = groupChats(chats, { groupBy: 'date', sortBy: 'updated', projectName, now: NOW }).map(s => s.key);
    const second = groupChats([...chats].reverse(), { groupBy: 'date', sortBy: 'updated', projectName, now: NOW }).map(s => s.key);
    expect(second).toEqual(first);
  });
});
