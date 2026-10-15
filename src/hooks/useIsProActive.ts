import { useHasRegisteredScreen } from '../navigation/screenRegistry';
import { selectHasProAccess } from '../stores/proAccessSlice';
import { useAppStore } from '../stores';

/**
 * Single reactive source of truth for "are the Pro bundle's surfaces in the UI right now?".
 *
 * Those surfaces are registered by loadProFeatures(), which calls pro.activate() and registers the Pro
 * Tools destination screen ('McpServers'). Registration is now the WHOLE answer, because there is nothing
 * to be entitled to: every feature that used to be sold is free, and selectHasProAccess() always grants.
 *
 * So this hook reads as "is the optional pro bundle part of this build?", and that is exactly how the UI
 * uses it - to decide whether a surface EXISTS, never whether someone may use it. A build without the
 * bundle registers nothing, and the app shows an honest empty state rather than a way to pay.
 *
 * Gating UI on the registered screen mirrors the handleProToolsPress check in ChatMessageArea, so the
 * whole app agrees on one definition.
 */
export const PRO_TOOLS_SCREEN = 'McpServers';

export function useIsProActive(): boolean {
  const registered = useHasRegisteredScreen(PRO_TOOLS_SCREEN);
  // Kept as a subscription rather than dropped: registration is the live half (the bundle can be loaded
  // at runtime, e.g. Fast Refresh or a mesh hand-off, with no app restart), and the access read keeps
  // every caller in step with the one rule by construction. It always returns true today.
  const hasAccess = useAppStore(selectHasProAccess);
  return registered && hasAccess;
}
