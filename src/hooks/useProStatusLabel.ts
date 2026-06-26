import { useEffect, useState } from 'react';
import { useAppStore } from '../stores';
import { getProLicenseInfo, type ProLicenseInfo } from '../services/proLicenseService';

/**
 * Label for the Settings "Off Grid PRO" row: the upsell line when not Pro, or
 * the subscription status (Lifetime / Monthly active-until-date) when Pro.
 */
export function useProStatusLabel(): { hasRegisteredPro: boolean; proStatusLabel: string } {
  const hasRegisteredPro = useAppStore((s) => s.hasRegisteredPro);
  const [info, setInfo] = useState<ProLicenseInfo | null>(null);
  useEffect(() => {
    if (hasRegisteredPro) getProLicenseInfo().then(setInfo).catch(() => {});
  }, [hasRegisteredPro]);

  const proStatusLabel = !hasRegisteredPro
    ? 'Unlock premium features'
    : info?.tier === 'monthly' && info.expiry
      ? `Active until ${new Date(info.expiry).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : 'Lifetime · active';

  return { hasRegisteredPro, proStatusLabel };
}
