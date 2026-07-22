const REDACTED = '[REDACTED]';

const SECRET_NAME =
  '(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|apikey|password)';
const QUERY_SECRET_NAME = `(?:${SECRET_NAME.slice(3, -1)}|code)`;

/** Remove credentials before a diagnostic line reaches memory, disk, copy, or share. */
export function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/(\bBearer\s+)[^\s,"'}\]]+/gi, `$1${REDACTED}`)
    .replace(
      /(\bauthorization\s*[:=]\s*)(?!Bearer\b)[^\s,"'}\]]+/gi,
      `$1${REDACTED}`,
    )
    .replace(
      new RegExp(
        `(["']?${SECRET_NAME}["']?\\s*[:=]\\s*["']?)([^\\s,"'}&\\]]+)`,
        'gi',
      ),
      `$1${REDACTED}`,
    )
    .replace(
      new RegExp(`([?&]${QUERY_SECRET_NAME}=)[^&#\\s]+`, 'gi'),
      `$1${REDACTED}`,
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED);
}
