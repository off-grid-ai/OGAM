/**
 * Atlas emergency packages in four sizes, built from the subject packs. A pack's file name starts with its subject number
 * (01_Medical...), so a size is a list of subject numbers; each larger size adds subjects to the one before. Pure, so it is
 * tested without a device.
 */
export type TierId = 'small' | 'medium' | 'large' | 'full';

interface TierDef { id: TierId; name: string; blurb: string; adds: string[] }

const SMALL = ['01', '02', '06'];
const MEDIUM = ['03', '04'];
const LARGE = ['05', '07', '08'];

export const TIERS: TierDef[] = [
  { id: 'small', name: 'Small', blurb: 'Medicine, water and sanitation, survival and navigation. The essentials to keep people alive.', adds: SMALL },
  { id: 'medium', name: 'Medium', blurb: 'Small, plus food and farming, power and repair.', adds: MEDIUM },
  { id: 'large', name: 'Large', blurb: 'Medium, plus science and measurement, rebuilding crafts, languages and general reference.', adds: LARGE },
  { id: 'full', name: 'Full', blurb: 'Everything: all of the above plus the visual atlases (plants, anatomy) and historical craft manuals.', adds: [] },
];

/** The subject numbers a size includes (Full has no list: it is every pack). */
export function tierSubjects(id: TierId): string[] | 'all' {
  if (id === 'full') return 'all';
  const upTo = TIERS.findIndex((t) => t.id === id);
  return TIERS.slice(0, upTo + 1).flatMap((t) => t.adds);
}

const subjectOf = (packName: string) => /^(\d{2})_/.exec(packName)?.[1] ?? '';

/** The packs that make up a size, from the list of published packs. */
export function packsForTier<T extends { name: string }>(id: TierId, packs: T[]): T[] {
  const subjects = tierSubjects(id);
  return subjects === 'all' ? packs : packs.filter((p) => subjects.includes(subjectOf(p.name)));
}

export const tierBytes = (id: TierId, packs: { name: string; size: number }[]): number =>
  packsForTier(id, packs).reduce((n, p) => n + p.size, 0);
