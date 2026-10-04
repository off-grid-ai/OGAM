function isUnknownLike(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 || normalized === 'unknown';
}

function shouldSkipSuspiciousRecoveredTextModel(author: string, quantization: string, fileSize: number): boolean {
  const MIN_RECOVERED_TEXT_MODEL_BYTES = 100 * 1024 * 1024;

  if (isUnknownLike(author) || isUnknownLike(quantization)) {
    return fileSize < MIN_RECOVERED_TEXT_MODEL_BYTES;
  }
  return false;
}

describe('shouldSkipSuspiciousRecoveredTextModel', () => {
  it('should skip small files with unknown author', () => {
    const result = shouldSkipSuspiciousRecoveredTextModel('Unknown', 'Q4_K_M', 14 * 1024 * 1024);
    expect(result).toBe(true);
  });

  it('should skip small files with unknown quantization', () => {
    const result = shouldSkipSuspiciousRecoveredTextModel('unsloth', 'Unknown', 50 * 1024 * 1024);
    expect(result).toBe(true);
  });

  it('should skip small files with both unknown author and quantization', () => {
    const result = shouldSkipSuspiciousRecoveredTextModel('Unknown', 'Unknown', 16 * 1024 * 1024);
    expect(result).toBe(true);
  });

  it('should not skip large files even with unknown metadata', () => {
    const result = shouldSkipSuspiciousRecoveredTextModel('Unknown', 'Unknown', 2 * 1024 * 1024 * 1024);
    expect(result).toBe(false);
  });

  it('should not skip small files with valid metadata', () => {
    const result = shouldSkipSuspiciousRecoveredTextModel('huggingface', 'Q4_K_M', 50 * 1024 * 1024);
    expect(result).toBe(false);
  });

  it('should not skip files right at the threshold', () => {
    const result = shouldSkipSuspiciousRecoveredTextModel('Unknown', 'Unknown', 100 * 1024 * 1024);
    expect(result).toBe(false);
  });

  it('should skip files just below the threshold', () => {
    const result = shouldSkipSuspiciousRecoveredTextModel('Unknown', 'Unknown', (100 * 1024 * 1024) - 1);
    expect(result).toBe(true);
  });

  it('should handle empty author as unknown', () => {
    const result = shouldSkipSuspiciousRecoveredTextModel('', 'Q4_K_M', 50 * 1024 * 1024);
    expect(result).toBe(true);
  });

  it('should handle whitespace-only quantization as unknown', () => {
    const result = shouldSkipSuspiciousRecoveredTextModel('author', '  ', 50 * 1024 * 1024);
    expect(result).toBe(true);
  });

  it('should be case-insensitive for unknown check', () => {
    const result1 = shouldSkipSuspiciousRecoveredTextModel('UNKNOWN', 'Q4_K_M', 50 * 1024 * 1024);
    const result2 = shouldSkipSuspiciousRecoveredTextModel('UnKnOwN', 'Q4_K_M', 50 * 1024 * 1024);
    expect(result1).toBe(true);
    expect(result2).toBe(true);
  });
});
