/**
 * The document excerpts the latest reply was written from, numbered as the model saw them ([1], [2]...), kept for the source
 * list under the reply. Set when the excerpts are put in the prompt and read when the reply is finished.
 */
export interface TurnSource { title: string; quote: string; /** The project document it came from, so the source can be opened. */ file?: { path: string; name: string; size: number } }

let current: TurnSource[] = [];
export const setTurnSources = (sources: TurnSource[]): void => { current = sources; };
export const turnSources = (): TurnSource[] => current;

/** The excerpts of a search result as numbered sources (the number is the position + 1, as in the prompt). */
export function sourcesFromChunks(chunks: Array<{ name: string; position: number; content: string }>, docs: Array<{ name: string; path: string; size?: number }> = []): TurnSource[] {
  return chunks.map((c) => {
    const doc = docs.find((d) => d.name === c.name);
    return { title: `${c.name} (part ${c.position + 1})`, quote: c.content.replace(/\s+/g, ' ').trim().slice(0, 200), ...(doc?.path ? { file: { path: doc.path, name: doc.name, size: doc.size ?? 0 } } : {}) };
  });
}
