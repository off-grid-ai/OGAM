import { normalizePastedLicenseKey } from '../../../pro/licensing/pastedLicenseKey';

const KEY = 'key/eyJhY2NvdW50Ijp7ImlkIjoiYzIzIn19.QmFzZTY0U2lnbmF0dXJlPT0=';

describe('normalizePastedLicenseKey', () => {
  it('leaves a clean key as it is', () => {
    expect(normalizePastedLicenseKey(KEY)).toBe(KEY);
  });

  it('takes out line breaks a wrapped email put in the key', () => {
    expect(
      normalizePastedLicenseKey(`${KEY.slice(0, 20)}\r\n${KEY.slice(20)}\n`),
    ).toBe(KEY);
  });

  it('takes out invisible characters copied with the key', () => {
    expect(
      normalizePastedLicenseKey(
        `\uFEFF${KEY.slice(0, 10)}\u200B${KEY.slice(10)}\u00AD\u2060`,
      ),
    ).toBe(KEY);
  });

  it('takes off quotes and brackets around the key', () => {
    expect(normalizePastedLicenseKey(`\u201C${KEY}\u201D`)).toBe(KEY);
    expect(normalizePastedLicenseKey(`<${KEY}>`)).toBe(KEY);
    expect(normalizePastedLicenseKey(`'${KEY}'`)).toBe(KEY);
  });

  it('keeps the key when the line before it was copied too', () => {
    expect(
      normalizePastedLicenseKey(`Here is your lifetime license key.\n\n${KEY}`),
    ).toBe(KEY);
    expect(normalizePastedLicenseKey(`License key: ${KEY}`)).toBe(KEY);
  });

  it('keeps the trailing = of the signature', () => {
    expect(normalizePastedLicenseKey(`${KEY}  `).endsWith('=')).toBe(true);
  });

  it('gives an empty string for a paste of nothing but spaces', () => {
    expect(normalizePastedLicenseKey(' \n\u200B ')).toBe('');
  });
});
