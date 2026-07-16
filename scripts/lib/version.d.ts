// Types for scripts/lib/version.js (a plain-JS module bash runs directly). Kept
// alongside so the jest test and `tsc --noEmit` resolve it without allowJs.
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}
export interface ParsedBetaTag {
  version: string;
  beta: number;
}
export function parseVersion(version: string): ParsedVersion;
export function nextPatch(version: string): string;
export function parseBetaTag(tag: string): ParsedBetaTag;
export function targetVersionFromBetaTag(tag: string): string;
export function betaTag(targetVersion: string, n: number | string): string;
export function parseBuildNumber(build: number | string): string;
export function buildAnnotationLine(build: number | string): string;
export function buildNumberFromAnnotation(annotation: string): string;
