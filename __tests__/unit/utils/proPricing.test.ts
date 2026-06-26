import { getPricingCopy, MONTHLY_CUTOVER_UTC } from '../../../src/utils/proPricing';

describe('getPricingCopy', () => {
  const dayBefore = MONTHLY_CUTOVER_UTC - 1;
  const cutover = MONTHLY_CUTOVER_UTC;
  const dayAfter = MONTHLY_CUTOVER_UTC + 24 * 60 * 60 * 1000;

  it('offers the one-time lifetime deal before the July 1 cutover', () => {
    const copy = getPricingCopy(dayBefore);
    expect(copy.title).toMatch(/lifetime/i);
    expect(copy.subtitle).toMatch(/\$39\/month/); // mentions what it becomes
    expect(copy.cta).toBe('Get Pro');
  });

  it('switches to the monthly plan at the cutover (inclusive)', () => {
    const copy = getPricingCopy(cutover);
    expect(copy.title).toBe('$39/month');
    expect(copy.cta).toMatch(/\$39\/mo/);
  });

  it('stays on the monthly plan after the cutover', () => {
    const copy = getPricingCopy(dayAfter);
    expect(copy.title).toBe('$39/month');
    expect(copy.label).toBe('FOUNDER RATE');
  });
});
