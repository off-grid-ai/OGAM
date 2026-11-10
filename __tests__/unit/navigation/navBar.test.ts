import { DEFAULT_HIDDEN, MAX_VISIBLE, moveNavItem, resolveNavBar, setNavItemVisible } from '../../../src/utils/navBar';

describe('bottom bar rules', () => {
  it('defaults to Home, Chats, Workspace, Learn and Settings', () => {
    const r = resolveNavBar(undefined);
    expect(r.visible).toEqual(['home', 'chats', 'workspace', 'language', 'settings']);
    expect(r.labels).toBe(true);
    expect(DEFAULT_HIDDEN).toContain('models');
  });

  it('turns an item on up to five, never more', () => {
    // The default bar is already full: turning Models on needs a free place (Learn here).
    expect(resolveNavBar(setNavItemVisible(undefined, 'models', true)).visible).not.toContain('models');
    let s = setNavItemVisible(undefined, 'language', false);
    s = setNavItemVisible(s, 'models', true);
    expect(resolveNavBar(s).visible).toContain('models');
    expect(resolveNavBar(s).visible).toHaveLength(MAX_VISIBLE);
    s = setNavItemVisible(s, 'compass', true);
    expect(resolveNavBar(s).visible).not.toContain('compass');
  });

  it('keeps Settings and at least two items', () => {
    expect(resolveNavBar(setNavItemVisible(undefined, 'settings', false)).visible).toContain('settings');
    let s = setNavItemVisible(undefined, 'home', false);
    s = setNavItemVisible(s, 'chats', false);
    expect(resolveNavBar(s).visible).toEqual(['workspace', 'language', 'settings']);
    s = setNavItemVisible(s, 'workspace', false);
    expect(resolveNavBar(s).visible).toEqual(['language', 'settings']);
    s = setNavItemVisible(s, 'language', false); // would leave only Settings
    expect(resolveNavBar(s).visible).toEqual(['language', 'settings']);
  });

  it('moves items and keeps the choice of what is shown', () => {
    // Settings passes the hidden Models row, then Learn.
    const s = moveNavItem(moveNavItem(undefined, 'settings', -1), 'settings', -1);
    expect(resolveNavBar(s).order.slice(0, 6)).toEqual(['home', 'chats', 'workspace', 'settings', 'language', 'models']);
    expect(resolveNavBar(s).visible).toEqual(['home', 'chats', 'workspace', 'settings', 'language']);
    expect(resolveNavBar(moveNavItem(s, 'home', -1)).visible[0]).toBe('home'); // already first
  });

  it('survives bad saved data', () => {
    const r = resolveNavBar({ order: ['models', 'nope' as any, 'models', 'home'], hidden: ['settings', 'chats', 'workspace', 'home', 'models'] });
    expect(r.visible).toContain('settings');
    expect(r.visible.length).toBeGreaterThanOrEqual(2);
    expect(new Set(r.order).size).toBe(r.order.length);
    const tooMany = resolveNavBar({ hidden: [] });
    expect(tooMany.visible).toHaveLength(MAX_VISIBLE);
    expect(tooMany.visible).toContain('settings');
  });
});

describe('vibration setting', () => {
  it('stops haptics when switched off', () => {
    const haptic = require('react-native-haptic-feedback');
    const { useAppStore } = require('../../../src/stores/appStore');
    const { triggerHaptic } = require('../../../src/services/haptics');
    const trigger = (haptic.default ?? haptic).trigger as jest.Mock;
    trigger.mockClear();
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, hapticsOff: false } });
    triggerHaptic('selection');
    expect(trigger).toHaveBeenCalledTimes(1);
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, hapticsOff: true } });
    triggerHaptic('selection');
    expect(trigger).toHaveBeenCalledTimes(1);
  });
});

describe('items added in an update', () => {
  it('start hidden for someone who already arranged their bar', () => {
    const { resolveNavBar } = require('../../../src/utils/navBar');
    // Saved before the Record shortcut existed: no "recorder" in the order or the hidden list.
    const saved = { order: ['home', 'chats', 'workspace', 'models', 'settings', 'emergency', 'library', 'brief', 'compass', 'phrases', 'survival'], hidden: ['models', 'library', 'compass', 'phrases', 'survival'] };
    const r = resolveNavBar(saved);
    expect(r.visible).not.toContain('recorder');
    expect(r.order).toContain('recorder');
  });
});
