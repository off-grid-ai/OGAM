/** Where the person stopped listening to a briefing, so opening it again carries on from there. */
export interface Listened { key: string; line: number }

/** The line to start from: the saved one when it belongs to this briefing and is not the last line, else the beginning. */
export function resumeLine(saved: Listened | null | undefined, key: string, lineCount: number): number {
  if (!saved || saved.key !== key) return 0;
  return Number.isInteger(saved.line) && saved.line > 0 && saved.line < lineCount - 1 ? saved.line : 0;
}
