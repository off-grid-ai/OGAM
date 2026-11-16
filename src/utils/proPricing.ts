/**
 * Off Grid AI Pro pricing copy, shared by every Pro surface so they stay in sync.
 *
 * Two plans, matching getoffgridai.co/pro: a one-time lifetime purchase and a monthly
 * subscription. The app names the plans but never a price: Get Pro opens the checkout sheet
 * (getoffgridai.co/pro/app/, see services/proCheckout), which shows the live price, so a
 * price change never needs an app release.
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
    title: 'Lifetime or monthly',
    subtitle: "Lock in today's rate - it only goes up, never down. One license covers up to 5 devices, laptop and phone.",
    cta: 'Get Pro',
    sheetSubheadline: 'Off Grid AI Pro - pay once for life, or monthly.',
    sheetFooter: 'Founder rate, locked in when you join. Monthly renews; lifetime is a one-time payment.',
  };
}
