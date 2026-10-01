import { getPricingCopy } from '../../../src/utils/proPricing';

describe('getPricingCopy', () => {
  const copy = getPricingCopy();

  it('offers the two current plans - $4.99/month and $69 lifetime - and no yearly', () => {
    expect(copy.title).toBe('$4.99/month or $69 lifetime');
    expect(copy.sheetSubheadline).toMatch(/\$4\.99 a month/);
    expect(copy.sheetSubheadline).toMatch(/\$69 once/);
    // The retired yearly plan must not resurface anywhere in the copy.
    const all = Object.values(copy).join(' ');
    expect(all).not.toMatch(/year|annual|\$49/i);
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
