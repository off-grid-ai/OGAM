// Types for scripts/lib/engines.js (a plain-JS module node runs directly). Kept alongside so the
// jest test and `tsc --noEmit` resolve it without allowJs.
export interface Engine {
  id: string;
  what: string;
  source: 'npm' | 'maven';
  pkg?: string;
  with?: string[];
  group?: string;
  artifact?: string;
  file?: string;
}
export interface UnmetPeer {
  name: string;
  range: string;
  have: string | null;
}
export type Decision =
  | { status: 'current' }
  | { status: 'bump'; to: string }
  | { status: 'held'; to: string; reason: string };
export interface EngineResult {
  id: string;
  what: string;
  from: string;
  status: 'current' | 'bump' | 'held';
  to?: string;
  reason?: string;
}
export const ENGINES: Engine[];
export function pinnedVersion(spec: string | undefined): string | null;
export function specFor(oldSpec: string, version: string): string;
export function unmetPeers(
  peerDependencies: Record<string, string> | undefined,
  peerDependenciesMeta: Record<string, { optional?: boolean }> | undefined,
  installed: Record<string, string | undefined>,
): UnmetPeer[];
export function decide(input: {
  current: string | null;
  latest: string | null;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  installed?: Record<string, string | undefined>;
  patch?: string | null;
}): Decision;
export function patchFileName(pkg: string, version: string): string;
export function mavenRelease(metadataXml: string): string | null;
export function gradlePin(gradle: string, group: string, artifact: string): string | null;
export function setGradlePin(gradle: string, group: string, artifact: string, version: string): string;
export function summaryMarkdown(results: EngineResult[]): string;
