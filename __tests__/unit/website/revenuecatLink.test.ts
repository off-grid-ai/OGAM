/**
 * RevenueCat Web Purchase Link builder tests.
 *
 * Covers the pure URL-building logic used by website/pay.md. The module is a
 * dependency-free UMD file shared between the browser page and this test.
 */

const RevenueCatLink = require('../../../website/assets/js/revenuecat-link.js') as {
  isValidEmail: (email: unknown) => boolean;
  buildPurchaseUrl: (
    token: unknown,
    email: unknown,
    opts?: { packageId?: string },
  ) => string | null;
};

const TOKEN = 'axcqzylghncldjwo';

describe('isValidEmail', () => {
  it.each([
    'user@example.com',
    'a.b+tag@sub.domain.co',
    '  spaced@example.com  ',
  ])('accepts %s', email => {
    expect(RevenueCatLink.isValidEmail(email)).toBe(true);
  });

  it.each(['', 'no-at-sign', 'missing@tld', '@example.com', 'a@b', null, undefined, 42])(
    'rejects %s',
    email => {
      expect(RevenueCatLink.isValidEmail(email as unknown)).toBe(false);
    },
  );
});

describe('buildPurchaseUrl', () => {
  it('uses the email as the App User ID path segment and prefills email', () => {
    expect(RevenueCatLink.buildPurchaseUrl(TOKEN, 'user@example.com')).toBe(
      'https://pay.rev.cat/axcqzylghncldjwo/user%40example.com?email=user%40example.com',
    );
  });

  it('URL-encodes special characters in the email (path and query)', () => {
    expect(RevenueCatLink.buildPurchaseUrl(TOKEN, 'a.b+tag@sub.domain.co')).toBe(
      'https://pay.rev.cat/axcqzylghncldjwo/a.b%2Btag%40sub.domain.co?email=a.b%2Btag%40sub.domain.co',
    );
  });

  it('trims surrounding whitespace before building the URL', () => {
    expect(RevenueCatLink.buildPurchaseUrl(TOKEN, '  user@example.com  ')).toBe(
      'https://pay.rev.cat/axcqzylghncldjwo/user%40example.com?email=user%40example.com',
    );
  });

  it('appends package_id when provided', () => {
    expect(
      RevenueCatLink.buildPurchaseUrl(TOKEN, 'user@example.com', {
        packageId: 'round2_30',
      }),
    ).toBe(
      'https://pay.rev.cat/axcqzylghncldjwo/user%40example.com?email=user%40example.com&package_id=round2_30',
    );
  });

  it('encodes the token in the path', () => {
    const url = RevenueCatLink.buildPurchaseUrl('tok/with space', 'user@example.com');
    expect(url).toContain('https://pay.rev.cat/tok%2Fwith%20space/');
  });

  it.each([
    [TOKEN, 'not-an-email'],
    [TOKEN, ''],
    ['', 'user@example.com'],
    [null, 'user@example.com'],
  ])('returns null for invalid input (token=%s, email=%s)', (token, email) => {
    expect(RevenueCatLink.buildPurchaseUrl(token as unknown, email as unknown)).toBeNull();
  });
});
