import { getPricingCopy } from '../../../src/utils/proPricing';

describe('getPricingCopy', () => {
  const copy = getPricingCopy();

  it('names the two plans sold on getoffgridai.co - lifetime and monthly - and no yearly', () => {
    expect(copy.title).toBe('Lifetime or monthly');
    expect(copy.sheetSubheadline).toMatch(/once for life, or monthly/);
    // The yearly plan is not sold; it must not resurface anywhere in the copy.
    const all = Object.values(copy).join(' ');
    expect(all).not.toMatch(/\byear(ly)?\b|\/yr/i);
  });

  it('states no price: the checkout sheet shows the live one, so a price change needs no release', () => {
    expect(Object.values(copy).join(' ')).not.toMatch(/\$\s?\d/);
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
