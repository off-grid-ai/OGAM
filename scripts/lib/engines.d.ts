// Types for scripts/lib/engines.js (a plain-JS module node runs directly). Kept alongside so the
// jest test and `tsc --noEmit` resolve it without allowJs.
export interface Engine {
  id: string;
  what: string;
  source: 'npm' | 'maven' | 'github';
  repo?: string;
  pkg?: string;
  /** The package.json key when it differs from `pkg` (an npm alias). */
  dep?: string;
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
  | { status: 'held'; to: string; reason: string; next: string };
export interface EngineResult {
  id: string;
  what: string;
  from: string;
  status: 'current' | 'bump' | 'held';
  to?: string;
  reason?: string;
  next?: string;
  /** ISO time the hold began (the oldest newer release's publish time). */
  since?: string | null;
}
export const ENGINES: Engine[];
export function npmPackage(spec: string | undefined, pkg: string): string;
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
export function githubDecision(input: { current: string | null; latest: string | null; status: string | null; patchProblem?: string | null }): Decision;
export function heldSince(times: Record<string, string> | undefined, current: string | null): string | null;
export const HELD_ISSUE_DAYS: number;
export function heldIssueTitle(id: string): string;
export function heldIssue(result: EngineResult, now: number): { title: string; body: string } | null;
export const BUMP_BRANCH: string;
export const BOT_EMAIL: string;
export interface BumpPr {
  state: string;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  isCrossRepository: boolean;
  commits: Array<{ authors: Array<{ login?: string; email: string }> }>;
  files: Array<{ path: string }>;
  statusCheckRollup: Array<{ name?: string; context?: string; conclusion?: string | null; state?: string | null }>;
}
export function bumpMergeDecision(pr: BumpPr, sha: string): { action: 'merge' | 'skip' | 'refuse'; reason?: string };
export const VIDEO_RUNTIME_CHECKS: string[];
export function videoRuntimeMoved(path: string): boolean;
export const RELEASE_WORKFLOWS: string[];
export function unfinishedRuns<T extends { status: string }>(runs: T[]): T[];
