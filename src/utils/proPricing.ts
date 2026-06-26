/**
 * Off Grid AI Pro pricing copy, shared by every Pro surface so they stay in sync.
 *
 * It flips at the July 1 cutover with no app update needed: a one-time lifetime
 * deal before July 1, then the monthly plan after. `now` is injectable for tests.
 */
export const MONTHLY_CUTOVER_UTC = Date.parse('2026-07-01T00:00:00Z');

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

export function getPricingCopy(now: number = Date.now()): ProPricingCopy {
  if (now >= MONTHLY_CUTOVER_UTC) {
    return {
      label: 'FOUNDER RATE',
      title: '$39/month',
      subtitle: 'The pre-launch founder rate, locked in for early members. Cancel anytime.',
      cta: 'Get Pro - $39/mo',
      sheetSubheadline: 'Off Grid AI Pro, billed monthly at the founder rate.',
      sheetFooter: 'Billed monthly. Cancel anytime.',
    };
  }
  return {
    label: 'BEFORE JULY 1',
    title: 'Lifetime, one payment',
    subtitle: 'Pay once, keep Pro for life - and Off Grid AI Pro free, forever. On July 1 this switches to $39/month.',
    cta: 'Get Pro',
    sheetSubheadline: 'Pay once and keep Pro for life - Off Grid AI Pro free, forever.',
    sheetFooter: 'Closes July 1, then it is $39/month.',
  };
}
