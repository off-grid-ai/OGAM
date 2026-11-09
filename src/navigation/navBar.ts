/**
 * The customizable bottom bar. Every destination is always registered as a tab route (so
 * navigate('ModelsTab') keeps working wherever it is called from), and the person's choice only
 * decides which ones are shown and in what order. Pure rules live here; the navigator and the
 * settings screen both use them.
 */
import type { RootStackParamList } from './types';

export type NavItemId =
  | 'home' | 'chats' | 'workspace' | 'models' | 'settings'
  | 'emergency' | 'library' | 'brief' | 'compass' | 'phrases' | 'recorder' | 'survival' | 'language';

export interface NavItem {
  id: NavItemId;
  label: string;
  icon: string;
  /** Tab route name. */
  route: string;
  /** Shortcut items open this full-screen destination instead of a tab page. */
  target?: keyof RootStackParamList;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: 'home', route: 'HomeTab', description: 'Your overview and quick starts' },
  { id: 'chats', label: 'Chats', icon: 'message-circle', route: 'ChatsTab', description: 'All conversations' },
  { id: 'workspace', label: 'Workspace', icon: 'folder', route: 'ProjectsTab', description: 'Projects, agents and study' },
  { id: 'language', label: 'Language', icon: 'book', route: 'LanguageTab', target: 'Language', description: 'Learn a language: lessons, games, calls' },
  { id: 'models', label: 'Models', icon: 'cpu', route: 'ModelsTab', description: 'Download, import and manage models' },
  { id: 'settings', label: 'Settings', icon: 'settings', route: 'SettingsTab', description: 'Always shown, so you can always change this' },
  { id: 'emergency', label: 'Emergency', icon: 'alert-triangle', route: 'EmergencyTab', target: 'Emergency', description: 'Emergency mode' },
  { id: 'library', label: 'Library', icon: 'book-open', route: 'LibraryTab', target: 'OfflineLibrary', description: 'Offline library' },
  { id: 'brief', label: 'Daily brief', icon: 'sun', route: 'BriefTab', description: 'Daily briefing' },
  { id: 'compass', label: 'Compass', icon: 'compass', route: 'CompassTab', target: 'Compass', description: 'Compass' },
  { id: 'phrases', label: 'Phrases', icon: 'globe', route: 'PhrasesTab', target: 'Phrases', description: 'Phrase trainer' },
  { id: 'recorder', label: 'Record', icon: 'mic', route: 'RecorderTab', target: 'Recorder', description: 'Recorder with speaker labels' },
  { id: 'survival', label: 'Manual', icon: 'life-buoy', route: 'SurvivalTab', target: 'SurvivalManual', description: 'Survival manual' },
];

/**
 * What holding a bottom tab does: the one thing you most often want from that area, without opening it first.
 * `link` is an atlas://app/... link (see appLinks.ts); `screen` opens a full-screen page.
 */
export const TAB_LONG_PRESS: Partial<Record<NavItemId, { label: string; link?: string; screen?: keyof RootStackParamList }>> = {
  home: { label: 'Search', screen: 'Search' },
  chats: { label: 'New chat', link: 'atlas://app/chat' },
  workspace: { label: 'New project', screen: 'ProjectEdit' },
  language: { label: 'Practice call', link: 'atlas://app/call' },
  models: { label: 'Downloads', screen: 'DownloadManager' },
  settings: { label: 'Appearance', screen: 'Appearance' },
};

export interface NavBarSetting {
  /** Order of every item; items missing here are appended in their default place. */
  order?: NavItemId[];
  /** Items switched off. When never set, only the default four are on. */
  hidden?: NavItemId[];
  /** Show a text label under each icon (default on). */
  labels?: boolean;
}

export const MAX_VISIBLE = 5;
export const MIN_VISIBLE = 2;
/** Settings cannot be hidden: it is where this is changed. */
export const LOCKED: NavItemId = 'settings';
/** Out of the box: Home, Chats, Workspace, Learn and Settings. Models and the other shortcuts are one tap away elsewhere. */
export const DEFAULT_HIDDEN: NavItemId[] = ['models', 'emergency', 'library', 'brief', 'compass', 'phrases', 'recorder', 'survival'];

const ALL = NAV_ITEMS.map((i) => i.id);
export const navItem = (id: NavItemId): NavItem => NAV_ITEMS.find((i) => i.id === id)!;

export interface ResolvedNavBar { order: NavItemId[]; visible: NavItemId[]; labels: boolean }

/** The full order, the shown items (at most five, always including Settings) and the label choice. */
export function resolveNavBar(setting?: NavBarSetting): ResolvedNavBar {
  const known = (setting?.order ?? []).filter((id, i, a) => ALL.includes(id) && a.indexOf(id) === i);
  const order = [...known, ...ALL.filter((id) => !known.includes(id))];
  // Items added in a later version (not in the saved order) start hidden, like on a fresh install.
  const added = setting?.order ? DEFAULT_HIDDEN.filter((id) => !setting.order!.includes(id)) : [];
  const hidden = new Set([...(setting?.hidden ?? DEFAULT_HIDDEN), ...added]);
  hidden.delete(LOCKED);
  let visible = order.filter((id) => !hidden.has(id));
  if (visible.length > MAX_VISIBLE) {
    const keep = visible.filter((id) => id !== LOCKED).slice(0, MAX_VISIBLE - 1);
    visible = order.filter((id) => id === LOCKED || keep.includes(id));
  }
  if (visible.length < MIN_VISIBLE) {
    const extra = order.find((id) => !visible.includes(id));
    if (extra) visible = order.filter((id) => visible.includes(id) || id === extra);
  }
  return { order, visible, labels: setting?.labels !== false };
}

/** Turns an item on or off. Returns the same setting when the change is not allowed. */
export function setNavItemVisible(setting: NavBarSetting | undefined, id: NavItemId, on: boolean): NavBarSetting {
  const current = resolveNavBar(setting);
  const shown = current.visible.includes(id);
  if (on === shown) return setting ?? {};
  if (!on && (id === LOCKED || current.visible.length <= MIN_VISIBLE)) return setting ?? {};
  if (on && current.visible.length >= MAX_VISIBLE) return setting ?? {};
  const hidden = ALL.filter((x) => (x === id ? !on : !current.visible.includes(x)));
  return { ...setting, order: current.order, hidden };
}

/** Moves an item one place earlier (-1) or later (+1) among all items. */
export function moveNavItem(setting: NavBarSetting | undefined, id: NavItemId, dir: -1 | 1): NavBarSetting {
  const current = resolveNavBar(setting);
  const i = current.order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= current.order.length) return setting ?? {};
  const order = [...current.order];
  [order[i], order[j]] = [order[j], order[i]];
  return { ...setting, order, hidden: ALL.filter((x) => !current.visible.includes(x)) };
}
