import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MOBILE_CATALOG_URL,
  diffMergedCatalog,
  loadCachedCatalog,
  mergeCatalogEntries,
  mobileCatalogKey,
  parseMobileCatalogSections,
  refreshRemoteCatalog,
  type CatalogCache,
  type CatalogFetch,
  type MobileCatalogSections,
} from '@offgrid/models';
import logger from '../utils/logger';

/**
 * The remote recommended-model catalog (OGAM catalog/models.json). A new curated model ships by
 * editing that file, not by releasing the app. The app fetches it only when the person taps "check
 * for new models"; launch reads the copy a previous check saved, never the network. Fetch, validation and the merge rule are the shared
 * package's (@offgrid/models remote-catalog); this store is the phone's ports (fetch, AsyncStorage)
 * and the reactive copy screens read. The bundled lists stay the fallback: each one is merged with
 * its remote section through `withRemoteCatalog`, which only adds or replaces by key.
 */
const CACHE_KEY = '@offgrid/remote-model-catalog';

const cache: CatalogCache = {
  read: () => AsyncStorage.getItem(CACHE_KEY),
  write: raw => AsyncStorage.setItem(CACHE_KEY, raw),
};

const source = {
  url: MOBILE_CATALOG_URL,
  fetch: fetch as CatalogFetch,
  cache,
  parseSections: parseMobileCatalogSections,
};

type Section = keyof MobileCatalogSections;
type SectionEntry<K extends Section> = NonNullable<MobileCatalogSections[K]>[number];

export type CatalogCheckResult =
  | { status: 'new'; names: string[] }
  | { status: 'updated' }
  | { status: 'none' }
  | { status: 'failed' };

interface ModelCatalogState {
  remote: MobileCatalogSections;
  fetchedAt: number | null;
  isChecking: boolean;
}

export const useModelCatalogStore = create<ModelCatalogState>(() => ({
  remote: {},
  fetchedAt: null,
  isChecking: false,
}));

// One memo per section, so a merged list keeps its identity until its remote section changes
// (screens use it in deps and selectors).
const memo = new Map<Section, { remote: unknown; bundled: unknown; merged: unknown[] }>();

function mergeSection<K extends Section>(
  section: K,
  bundled: readonly SectionEntry<K>[],
  remote: MobileCatalogSections[K],
): SectionEntry<K>[] {
  const hit = memo.get(section);
  if (hit && hit.remote === remote && hit.bundled === bundled) return hit.merged as SectionEntry<K>[];
  const key = mobileCatalogKey[section] as (entry: SectionEntry<K>) => string;
  const merged = mergeCatalogEntries(bundled, remote as readonly SectionEntry<K>[] | undefined, key);
  memo.set(section, { remote, bundled, merged });
  return merged;
}

/** A bundled list merged with its remote catalog section. */
export function withRemoteCatalog<K extends Section>(section: K, bundled: readonly SectionEntry<K>[]): SectionEntry<K>[] {
  return mergeSection(section, bundled, useModelCatalogStore.getState().remote[section]);
}

/** Same as withRemoteCatalog, and re-renders when the catalog updates. The section is passed in
 *  (not read inside) so the React Compiler's memo of this call changes with it. */
export function useWithRemoteCatalog<K extends Section>(section: K, bundled: readonly SectionEntry<K>[]): SectionEntry<K>[] {
  const remote = useModelCatalogStore(s => s.remote[section]);
  return mergeSection(section, bundled, remote);
}

// Registered by the modules that own a bundled list, so a manual check can count what is new
// without this store importing them.
const bundledLists: { [K in Section]?: readonly SectionEntry<K>[] } = {};
export function registerBundledCatalog<K extends Section>(section: K, bundled: readonly SectionEntry<K>[]): void {
  (bundledLists as Record<Section, unknown>)[section] = bundled;
}

/** Every merged list the person sees, by section (the bundled list alone when nothing is cached). */
function mergedLists(): Map<Section, unknown[]> {
  const lists = new Map<Section, unknown[]>();
  (Object.keys(mobileCatalogKey) as Section[]).forEach(section =>
    lists.set(section, withRemoteCatalog(section, (bundledLists[section] ?? []) as never[])));
  return lists;
}

async function refresh(): Promise<CatalogCheckResult> {
  const before = mergedLists();
  const result = await refreshRemoteCatalog(source);
  if (result.catalog) {
    useModelCatalogStore.setState({ remote: result.catalog.sections, fetchedAt: result.catalog.fetchedAt });
  }
  if (result.status === 'failed') {
    logger.warn('[ModelCatalog] refresh failed:', result.error);
    return { status: 'failed' };
  }
  const added = new Set<string>();
  let changed = false;
  for (const [section, after] of mergedLists()) {
    const key = mobileCatalogKey[section] as (entry: unknown) => string;
    const diff = diffMergedCatalog(before.get(section) ?? [], after, key);
    // One model can sit in two sections (the picks pool and the list): name it once.
    diff.added.forEach(e => {
      const entry = e as { name?: string; displayName?: string };
      added.add(entry.displayName ?? entry.name ?? key(e));
    });
    changed = changed || diff.changed.length > 0 || diff.removed.length > 0;
  }
  if (added.size > 0) return { status: 'new', names: [...added] };
  // Changed entries with no new name: the catalog replaced models this phone already lists.
  return changed ? { status: 'updated' } : { status: 'none' };
}

/** Startup: the catalog a previous check saved, if any. No fetch. Never throws. */
export async function initModelCatalog(): Promise<void> {
  try {
    const cached = await loadCachedCatalog(source);
    if (cached) useModelCatalogStore.setState({ remote: cached.sections, fetchedAt: cached.fetchedAt });
  } catch (error) {
    logger.warn('[ModelCatalog] init failed:', error);
  }
}

/** The Models screen's "check for new models". */
export async function checkForNewModels(): Promise<CatalogCheckResult> {
  if (useModelCatalogStore.getState().isChecking) return { status: 'none' };
  useModelCatalogStore.setState({ isChecking: true });
  try {
    return await refresh();
  } catch {
    return { status: 'failed' };
  } finally {
    useModelCatalogStore.setState({ isChecking: false });
  }
}
