import { useEffect, useState } from 'react';
import { useAppStore } from '../stores';
import { getProLicenseInfo, PRO_TIER_META, type ProLicenseInfo } from '../services/proLicenseService';

/**
 * Label for the Settings "Off Grid AI PRO" row: the upsell line when not Pro, or
 * the subscription status (a renewing tier shows its date; a one-time tier shows
 * "<Tier> · active") when Pro.
 */
export function useProStatusLabel(): { hasRegisteredPro: boolean; proStatusLabel: string } {
  const hasRegisteredPro = useAppStore((s) => s.hasRegisteredPro);
  const [info, setInfo] = useState<ProLicenseInfo | null>(null);
  useEffect(() => {
    if (hasRegisteredPro) getProLicenseInfo().then(setInfo).catch(() => {});
  }, [hasRegisteredPro]);

  // Drive off the tier's `renews` flag (single source), not a concrete-tier check.
  const meta = info?.tier ? PRO_TIER_META[info.tier] : null;
  const proStatusLabel = !hasRegisteredPro
    ? 'Unlock premium features'
    : meta?.renews && info?.expiry
      ? `Active until ${new Date(info.expiry).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : `${meta?.label ?? 'Lifetime'} · active`;

  return { hasRegisteredPro, proStatusLabel };
}
