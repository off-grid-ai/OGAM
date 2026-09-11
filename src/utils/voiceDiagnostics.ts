import logger from './logger';

type VoiceDiagnosticValue = string | number | boolean | null | undefined;

/** Stable, content-free diagnostics for tracing one voice turn across UI and native boundaries. */
export function logVoiceDiagnostic(
  event: string,
  fields: Readonly<Record<string, VoiceDiagnosticValue>> = {},
): void {
  logger.log(
    `[VOICE-DIAGNOSTIC] ${JSON.stringify({
      event,
      at: Date.now(),
      ...fields,
    })}`,
  );
}

export function voiceDiagnosticError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}
