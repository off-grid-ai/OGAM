/**
 * Off Grid AI Pro pricing copy, shared by every Pro surface so they stay in sync.
 *
 * Two plans, matching getoffgridai.co/pro: a one-time lifetime purchase and a monthly
 * subscription. Both are founder rates that only ever go up as we grow, so the numbers are hardcoded to
 * today's tier and bumped in a new release when a tier fills. The web pay page
 * (getoffgridai.co/pay) is where checkout happens and holds the authoritative price.
 */
export interface ProPricingCopy {
  /** Small uppercase eyebrow label. */
  label: string;
  /** Headline price/offer. */
  title: string;
  /** Supporting line under the title. */
  subtitle: string;
  /** Call-to-action button label. */
  cta: string;
  /** One-line offer summary for the upsell sheet. */
  sheetSubheadline: string;
  /** Footer line for the upsell sheet (terms). */
  sheetFooter: string;
}

export function getPricingCopy(): ProPricingCopy {
  return {
    label: 'FOUNDER RATE',
    title: '$69 lifetime or $4.99/month',
    subtitle: "Lock in today's rate - it only goes up, never down. One license covers up to 5 devices, laptop and phone.",
    cta: 'Get Pro',
    sheetSubheadline: 'Off Grid AI Pro - $69 once for life, or $4.99 a month.',
    sheetFooter: 'Founder rate, locked in when you join. Monthly renews; lifetime is a one-time payment.',
  };
}
