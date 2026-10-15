import { useIsProActive } from './useIsProActive';

/**
 * Label for the Settings "Pro features" row.
 *
 * It used to be an upsell line ("Unlock premium features") or a subscription status read out of the
 * cached licence. Off Grid AI is free, so there is nothing to unlock and nothing to renew; the row now
 * says what is true of the feature set in THIS build, which is the only thing that can still differ:
 * whether the optional pro bundle (voice, tools, mesh sync) is compiled in.
 */
export function useProStatusLabel(): {
  proStatusLabel: string;
} {
  const bundleLoaded = useIsProActive();
  return {
    proStatusLabel: bundleLoaded
      ? 'Everything included, free'
      : 'Everything included, free - this build has no Pro bundle',
  };
}
