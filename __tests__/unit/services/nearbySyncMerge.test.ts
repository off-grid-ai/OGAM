import { mergeAgents, mergeConversations, mergeProjects, validateSnapshot } from '../../../src/services/nearbySync/merge';
import type { Conversation, Project } from '../../../src/types';
import type { Agent } from '../../../src/stores/agentStore';

const project = (name: string, at = '2026-01-01T00:00:00.000Z'): Project => ({
  id: 'project-1', name, description: '', systemPrompt: 'Shared instructions',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: at,
});
const chat = (messages: string[], at = '2026-01-01T00:00:00.000Z'): Conversation => ({
  id: 'chat-1', title: 'Conversation', modelId: 'qwen', createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: at, messages: messages.map((content, n) => ({
    id: `message-${  n}`, content, timestamp: 100 + n, role: 'user',
  })),
});
const agent = (name: string, at = '2026-01-01T00:00:00.000Z'): Agent => ({
  id: 'agent-1', name, description: '', systemPrompt: 'instructions',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: at,
});
describe('Atlas offline conflict-preserving merge', () => {
  it('adds remote projects and agents without replacing local records', () => {
    const p = mergeProjects([], [project('Therapy')]);
    const a = mergeAgents([], [agent('Sage')]);
    expect(p.items).toHaveLength(1);
    expect(a.items).toHaveLength(1);
    expect(p.added).toBe(1);
    expect(a.added).toBe(1);
  });
  it('merges an append-only conversation by retaining the longer transcript', () => {
    const result = mergeConversations([chat(['hello'])], [chat(['hello', 'world'], '2026-01-02T00:00:00.000Z')]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].messages.map(m => m.content)).toEqual(['hello', 'world']);
    expect(result.updated).toBe(1);
  });
  it('does not remove a local message when a remote transcript was shortened', () => {
    const result = mergeConversations([chat(['hello', 'world'])], [chat(['hello'], '2026-01-02T00:00:00.000Z')]);
    expect(result.items.map(c => c.messages.length)).toEqual([1, 2]);
    expect(result.conflicts).toBe(1);
  });
  it('preserves both sides of divergent conversation edits', () => {
    const first = chat(['first']);
    const other = chat(['different'], '2026-01-02T00:00:00.000Z');
    const merged = mergeConversations([first], [other]);
    expect(merged.items).toHaveLength(2);
    expect(merged.items[0].messages[0].content).toBe('different');
    expect(merged.items[1].messages[0].content).toBe('first');
    expect(merged.items[1].id).toMatch(/^chat-1-peer-/);
    expect(mergeConversations(merged.items, [other]).items).toHaveLength(2);
  });
  it('preserves old project and agent metadata on conflicting updates', () => {
    const mergedProjects = mergeProjects([project('Local')], [project('Remote', '2026-02-02T00:00:00.000Z')]);
    const mergedAgents = mergeAgents([agent('Old')], [agent('New', '2026-02-02T00:00:00.000Z')]);
    expect(mergedProjects.items.map(v => v.name)).toEqual(['Remote', 'Local (sync conflict)']);
    expect(mergedAgents.items.map(v => v.name)).toEqual(['New', 'Old (sync conflict)']);
  });
  it('excludes PIN-protected and temporary private messages', () => {
    expect(mergeConversations([], [{ ...chat(['secret']), pinVerifier: 'pin' }]).items).toHaveLength(0);
    expect(mergeConversations([], [{ ...chat(['temporary']), isPrivate: true }]).items).toHaveLength(0);
    const locked = { ...chat([]), pinVerifier: 'pin', protectedBlob: 'ciphertext' };
    const result = mergeConversations([locked], [chat(['leak'])]);
    expect(result.items).toEqual([locked]);
    const lockedProject = { ...project('Locked'), pinVerifier: 'verifier' };
    expect(mergeProjects([lockedProject], [project('Remote')]).items).toEqual([lockedProject]);
  });
  it('validates the authenticated peer snapshot schema', () => {
    const valid = { version: 1, sourceId: '12345678', projects: [], conversations: [], agents: [], files: [] };
    expect(validateSnapshot(valid)).toEqual(valid);
    expect(() => validateSnapshot({ ...valid, projects: null })).toThrow(/Unsupported/);
    expect(() => validateSnapshot({ ...valid, sourceId: '../other' })).toThrow(/Unsupported/);
  });
  it('converges when two offline devices edit the same chat at the same timestamp', () => {
    const left = chat(['left']);
    const right = chat(['right']);
    const fromLeft = mergeConversations([left], [right]).items;
    const fromRight = mergeConversations([right], [left]).items;
    expect(fromLeft).toEqual(fromRight);
    expect(fromLeft).toHaveLength(2);
    expect(mergeConversations(fromLeft, fromRight).items).toHaveLength(2);
  });
  it('treats a chat made on both phones (different ids, same title, one continues the other) as one chat', () => {
    const local = { ...chat(['hello']), id: 'phone-a-chat' };
    const remote = { ...chat(['hello', 'world'], '2026-01-02T00:00:00.000Z'), id: 'phone-b-chat' };
    const result = mergeConversations([local], [remote]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('phone-a-chat');
    expect(result.items[0].messages.map(m => m.content)).toEqual(['hello', 'world']);
    // And the other way round keeps this phone's longer chat without adding a second.
    expect(mergeConversations([remote], [local]).items).toHaveLength(1);
    // Syncing again changes nothing.
    expect(mergeConversations(result.items, [remote]).items).toHaveLength(1);
  });
  it('keeps both chats when two phones made different chats with the same title', () => {
    const result = mergeConversations([{ ...chat(['one']), id: 'a' }], [{ ...chat(['two']), id: 'b' }]);
    expect(result.items).toHaveLength(2);
  });
  it('does not add an agent or project that is the same thing made on both phones', () => {
    expect(mergeAgents([agent('Sage')], [{ ...agent('Sage', '2026-02-02T00:00:00.000Z'), id: 'agent-from-b' }]).items).toHaveLength(1);
    expect(mergeAgents([agent('Sage')], [{ ...agent('Sage'), id: 'agent-from-b', systemPrompt: 'different' }]).items).toHaveLength(2);
  });
});
