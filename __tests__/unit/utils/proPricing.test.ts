import { getPricingCopy } from '../../../src/utils/proPricing';

describe('getPricingCopy', () => {
  const copy = getPricingCopy();

  it('offers the two current plans - $49/yr and $69 lifetime - and no monthly', () => {
    expect(copy.title).toBe('$49/yr or $69 lifetime');
    expect(copy.sheetSubheadline).toMatch(/\$49 a year/);
    expect(copy.sheetSubheadline).toMatch(/\$69 once/);
    // The retired monthly plan must not resurface anywhere in the copy.
    const all = Object.values(copy).join(' ');
    expect(all).not.toMatch(/month/i);
    expect(all).not.toMatch(/\$39/);
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
