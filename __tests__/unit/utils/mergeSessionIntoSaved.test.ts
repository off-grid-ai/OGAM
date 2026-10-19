/**
 * The merge a store runs when its saved state could only be read after the user had started working
 * on the launch defaults. Pure function: the rendered journeys are chatHistoryLoadFailure and
 * projectsAfterFailedLoad.
 */
import { mergeSessionIntoSaved } from '../../../src/utils/mergeSessionIntoSaved';

const KEYS = ['items', 'settings', 'activeId'];

describe('mergeSessionIntoSaved', () => {
  const defaultA = { id: 'a', name: 'Default A' };
  const defaultB = { id: 'b', name: 'Default B' };
  const settings = { theme: 'light', size: 1 };
  const atLaunch = { items: [defaultA, defaultB], settings, activeId: null as string | null };

  it('takes the saved value for anything the session did not touch', () => {
    const saved = { items: [{ id: 's', name: 'Saved' }], settings: { theme: 'dark', size: 3 }, activeId: 's' };
    expect(mergeSessionIntoSaved(saved, atLaunch, atLaunch, KEYS)).toEqual(saved);
  });

  it('adds new records on the side the list grows from, and keeps the saved ones', () => {
    const saved = { ...atLaunch, items: [defaultA, { id: 's', name: 'Saved' }] };
    const prepended = { ...atLaunch, items: [{ id: 'n', name: 'New' }, defaultA, defaultB] };
    expect(mergeSessionIntoSaved(saved, prepended, atLaunch, KEYS).items.map(i => i.id)).toEqual(['n', 'a', 's']);
    const appended = { ...atLaunch, items: [defaultA, defaultB, { id: 'n', name: 'New' }] };
    expect(mergeSessionIntoSaved(saved, appended, atLaunch, KEYS).items.map(i => i.id)).toEqual(['a', 's', 'n']);
  });

  it('keeps a session edit and a session delete, and never brings back what the saved state removed', () => {
    // Saved: B was deleted before. Session: A was renamed and B deleted again (it was a launch default).
    const saved = { ...atLaunch, items: [defaultA, { id: 's', name: 'Saved' }] };
    const current = { ...atLaunch, items: [{ id: 'a', name: 'Renamed A' }] };
    expect(mergeSessionIntoSaved(saved, current, atLaunch, KEYS).items).toEqual([
      { id: 'a', name: 'Renamed A' },
      { id: 's', name: 'Saved' },
    ]);
  });

  it('merges a settings object field by field', () => {
    const saved = { ...atLaunch, settings: { theme: 'dark', size: 3 } };
    const current = { ...atLaunch, settings: { ...settings, size: 2 } };
    expect(mergeSessionIntoSaved(saved, current, atLaunch, KEYS).settings).toEqual({ theme: 'dark', size: 2 });
  });

  it('follows the session for keepCurrent keys, even when the session value is the launch value', () => {
    const saved = { ...atLaunch, activeId: 's' };
    expect(mergeSessionIntoSaved(saved, atLaunch, atLaunch, KEYS, ['activeId']).activeId).toBeNull();
  });
});
