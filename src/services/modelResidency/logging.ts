/**
 * [MEM-SM] log-line formatting for the residency manager.
 *
 * Extracted from index.ts (behavior-neutral) so the manager file stays within the
 * max-lines budget. These are PURE string builders — they produce the exact same
 * text the inline `logger.log('[MEM-SM] …')` calls produced; the manager still owns
 * WHEN a line is logged (call site + order unchanged), these only build the WHAT.
 */
import { Resident, ResidentType } from './policy';

interface FitSpec {
  key: string;
  sizeMB: number;
  dirtyMemory?: boolean;
}

interface EvictionPlanLike {
  fits: boolean;
  evict: Array<{ key: string }>;
}

/**
 * The primary fit-decision trace: the exact numbers behind every fit decision.
 * budgetForSpec already folds in the live os_proc budget under dirty pressure, so
 * there's one owner of the memory math - planEviction enforces it. Also logs the raw
 * os_proc figures (available/total) so a refusal is explainable.
 */
export function formatMakeRoomForLine(args: {
  spec: FitSpec;
  budgetMB: number;
  availMB: number;
  totalMB: number;
  residents: Array<Pick<Resident, 'key' | 'sizeMB' | 'pinned'> & { type?: ResidentType }>;
  plan: EvictionPlanLike;
}): string {
  const { spec, budgetMB, availMB, totalMB, residents, plan } = args;
  return `[MEM-SM] makeRoomFor ${spec.key} sizeMB=${
    spec.sizeMB
  } dirty=${!!spec.dirtyMemory} budgetMB=${budgetMB} os_procAvailMB=${availMB} totalMB=${totalMB} residents=[${residents
    .map(r => `${r.key}:${r.sizeMB}${r.pinned ? '(pinned)' : ''}`)
    .join(',')}] fits=${plan.fits} evict=[${plan.evict
    .map(e => e.key)
    .join(',')}]`;
}

/** OVERRIDE pre-eviction trace ("forcing load after evicting …"). */
export function formatOverrideForcingLine(specKey: string, evict: Array<{ key: string }>): string {
  return `[MEM-SM] makeRoomFor ${specKey} OVERRIDE - forcing load after evicting [${evict
    .map(e => e.key)
    .join(',')}]`;
}

/** OVERRIDE post-eviction trace after the survival check admits the load. */
export function formatOverrideAdmittedLine(args: {
  specKey: string;
  evict: Array<{ key: string }>;
  realAvailableMB: number;
  postLoadAvailableMB: number;
  floorMB: number;
}): string {
  return `[MEM-SM] makeRoomFor ${args.specKey} OVERRIDE - admitted after evicting [${args.evict.map(e => e.key).join(',')}] realAvailMB=${args.realAvailableMB} postLoadAvailMB=${args.postLoadAvailableMB} floorMB=${args.floorMB}`;
}

/** OVERRIDE post-eviction trace when the hard survival floor blocks native loading. */
export function formatOverrideRefusedLine(args: {
  specKey: string;
  realAvailableMB: number;
  effectiveAvailableMB: number;
  postLoadAvailableMB: number;
  floorMB: number;
}): string {
  return `[MEM-SM] makeRoomFor ${args.specKey} OVERRIDE - refused by survival floor realAvailMB=${args.realAvailableMB} effectiveAvailMB=${args.effectiveAvailableMB} postLoadAvailMB=${args.postLoadAvailableMB} floorMB=${args.floorMB}`;
}
