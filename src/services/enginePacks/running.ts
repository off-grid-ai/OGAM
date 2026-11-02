import { BuildInfo } from 'llama.rn';

/**
 * The llama.cpp build this process runs. BuildInfo.number is the bundled engine's (a JS constant);
 * on Android an engine pack may have loaded a newer one, which startEnginePacks records here.
 */
let packBuild: number | null = null;

export function setLoadedPackBuild(build: number | null): void {
  packBuild = build;
}

export function runningLlamaBuild(): number | undefined {
  if (packBuild) return packBuild;
  const build = Number.parseInt(String(BuildInfo?.number ?? ''), 10);
  return Number.isFinite(build) ? build : undefined;
}
