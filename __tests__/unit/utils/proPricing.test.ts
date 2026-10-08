import { getPricingCopy } from '../../../src/utils/proPricing';

describe('getPricingCopy', () => {
  const copy = getPricingCopy();

  it('offers the two plans sold on getoffgridai.co - $69 lifetime and $4.99/month - and no yearly', () => {
    expect(copy.title).toBe('$69 lifetime or $4.99/month');
    expect(copy.sheetSubheadline).toMatch(/\$69 once/);
    expect(copy.sheetSubheadline).toMatch(/\$4\.99 a month/);
    // The yearly plan is not sold; it must not resurface anywhere in the copy.
    const all = Object.values(copy).join(' ');
    expect(all).not.toMatch(/\byear(ly)?\b|\/yr/i);
    expect(all).not.toMatch(/\$49|\$39/);
  });

  it('keeps the Get Pro CTA (the web pay-page trigger the Pro surfaces assert)', () => {
    expect(copy.cta).toBe('Get Pro');
    expect(copy.label).toBe('FOUNDER RATE');
  });

  it('states the founder-rate terms (locked in, only goes up) and the 5-device cap', () => {
    expect(copy.subtitle).toMatch(/only goes up/i);
    expect(copy.subtitle).toMatch(/5 devices/);
  });
});
