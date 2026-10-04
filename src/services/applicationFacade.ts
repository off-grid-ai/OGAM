import type { OffGridApplication } from '@offgrid/application';

/**
 * The single accessor for the composed mobile application.
 *
 * It resolves the composition root itself rather than waiting to be handed a resolver. A
 * registration side-channel made the root reachable ONLY as an import side effect of
 * `composition/application`, so every consumer that arrived without `App.tsx` in its module graph -
 * a screen mounted on its own, a hook rendered directly - found the facade unconfigured. The
 * composition root, not the consumer's arrival path, owns whether the application exists.
 *
 * The require is deferred to call time on purpose: the root imports the mobile adapters and some of
 * those import this module, so a module-scope import would close that cycle before either side is
 * evaluated. By the time anything CALLS this, every module in the cycle is loaded.
 */
let override: (() => OffGridApplication) | null = null;

/**
 * Point the accessor at an application composed by the caller instead of the default root.
 *
 * This is a declared composition seam, not a back door: a caller that has already built an
 * `OffGridApplication` from real ports - a second root, or a harness composing the same adapters -
 * names it here so every consumer resolves that one instance. Pass `null` to return to the root.
 */
export function registerApplicationFacade(resolve: (() => OffGridApplication) | null): void {
  override = resolve;
}

export function applicationFacade(): OffGridApplication {
  if (override) return override();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getMobileApplication } =
    require('./composition/application') as typeof import('./composition/application');
  return getMobileApplication();
}
