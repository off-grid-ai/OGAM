import { sanitizeDiagnosticText } from '../../../src/utils/logSanitizer';

describe('sanitizeDiagnosticText', () => {
  it.each([
    [
      'Authorization: Bearer live-token-123',
      'Authorization: Bearer [REDACTED]',
    ],
    ['{"access_token":"live-token-123"}', '{"access_token":"[REDACTED]"}'],
    ['refresh_token=refresh-123', 'refresh_token=[REDACTED]'],
    [
      'https://host/callback?code=auth-code&state=safe',
      'https://host/callback?code=[REDACTED]&state=safe',
    ],
    ['provider key sk-abcdefgh12345678', 'provider key [REDACTED]'],
  ])('redacts %s', (input, expected) => {
    expect(sanitizeDiagnosticText(input)).toBe(expected);
  });

  it('leaves ordinary diagnostic context intact', () => {
    expect(sanitizeDiagnosticText('[GEN-SM] model=llama status=ready')).toBe(
      '[GEN-SM] model=llama status=ready',
    );
  });
});
