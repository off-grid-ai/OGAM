/**
 * UTM tagging for outbound links to our own web properties (getoffgridai.co,
 * offgridmobileai.co, wednesday.is), so we can attribute which in-app surface
 * drove a click. This is the single source of the param format — matching the
 * pre-existing convention already baked into WEDNESDAY_URL / the onboarding link:
 *
 *   utm_source = off-grid-mobile-app   (always — the traffic came from this app)
 *   utm_medium = <surface>             (which screen/card: home-promo, pro-detail, …)
 *   utm_campaign = in-app              (default; override for a specific campaign)
 *
 * Do NOT tag links to third parties that ignore UTM (GitHub) or share-intent text.
 *
 * Built by string concatenation rather than the URL/URLSearchParams API because
 * Hermes' support for those is inconsistent across RN versions — a pure string
 * transform behaves identically on every device.
 */
const UTM_SOURCE = 'off-grid-mobile-app';
const UTM_CAMPAIGN = 'in-app';

export function withUtm(url: string, medium: string, campaign: string = UTM_CAMPAIGN): string {
  const params =
    `utm_source=${UTM_SOURCE}` +
    `&utm_medium=${encodeURIComponent(medium)}` +
    `&utm_campaign=${encodeURIComponent(campaign)}`;
  // Preserve any #fragment — UTM params belong in the query string, before the hash.
  const hashIdx = url.indexOf('#');
  const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const fragment = hashIdx >= 0 ? url.slice(hashIdx) : '';
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}${params}${fragment}`;
}
