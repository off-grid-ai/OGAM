import { withUtm } from '../../../src/utils/utm';

describe('withUtm', () => {
  it('appends source/medium/campaign to a plain URL with ?', () => {
    expect(withUtm('https://getoffgridai.co/desktop', 'home-promo')).toBe(
      'https://getoffgridai.co/desktop?utm_source=off-grid-mobile-app&utm_medium=home-promo&utm_campaign=in-app',
    );
  });

  it('uses & when the URL already has a query string', () => {
    expect(withUtm('https://x.co/p?ref=1', 'pro-detail')).toBe(
      'https://x.co/p?ref=1&utm_source=off-grid-mobile-app&utm_medium=pro-detail&utm_campaign=in-app',
    );
  });

  it('inserts the params before a #fragment', () => {
    expect(withUtm('https://x.co/p#section', 'about')).toBe(
      'https://x.co/p?utm_source=off-grid-mobile-app&utm_medium=about&utm_campaign=in-app#section',
    );
  });

  it('honors a custom campaign', () => {
    expect(withUtm('https://x.co/pay', 'pro-checkout', 'launch-2026')).toContain(
      'utm_campaign=launch-2026',
    );
  });

  it('url-encodes medium and campaign', () => {
    expect(withUtm('https://x.co', 'a b', 'c&d')).toBe(
      'https://x.co?utm_source=off-grid-mobile-app&utm_medium=a%20b&utm_campaign=c%26d',
    );
  });

  it('always sets source to off-grid-mobile-app', () => {
    expect(withUtm('https://x.co', 'any')).toContain('utm_source=off-grid-mobile-app');
  });
});
