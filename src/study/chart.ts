/**
 * Charts in answers. The model writes a ```chart block of small JSON; the app draws it. Nothing is drawn from malformed data, and a
 * chart with no named source is labelled so the person knows the numbers were not backed by a document.
 */
export interface ChartSpec { type: 'pie' | 'bar' | 'line'; title: string; unit?: string; labels: string[]; values: number[]; source?: string }

export function parseChart(text: string): { chart?: ChartSpec; error?: string } {
  let j: any;
  try { j = JSON.parse(text); } catch { return { error: 'The chart data was not valid JSON.' }; }
  if (!j || !['pie', 'bar', 'line'].includes(j.type)) return { error: 'Chart type must be pie, bar or line.' };
  if (!Array.isArray(j.labels) || !Array.isArray(j.values) || j.labels.length !== j.values.length || j.labels.length < 2) return { error: 'A chart needs matching labels and values (at least 2).' };
  const values = j.values.map((v: unknown) => Number(v));
  if (values.some((v: number) => !Number.isFinite(v))) return { error: 'Every chart value must be a number.' };
  if (j.type === 'pie' && (values.some((v: number) => v < 0) || values.every((v: number) => v === 0))) return { error: 'A pie chart needs non-negative values that are not all zero.' };
  return { chart: { type: j.type, title: String(j.title ?? '').slice(0, 80), unit: j.unit ? String(j.unit).slice(0, 12) : undefined, labels: j.labels.map((l: unknown) => String(l).slice(0, 40)), values, source: j.source ? String(j.source).slice(0, 160) : undefined } };
}

/** Share of the whole for each slice, as percentages that add to 100 (largest remainder), so labels never show 101%. */
export function shares(values: number[]): number[] {
  const total = values.reduce((s, v) => s + v, 0);
  const raw = values.map((v) => (v / total) * 100);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((s, v) => s + v, 0);
  [...raw.keys()].sort((a, b) => (raw[b] - floor[b]) - (raw[a] - floor[a])).forEach((i) => { if (left-- > 0) floor[i]++; });
  return floor;
}

export const chartCaption = (c: ChartSpec) => (c.source ? `Source: ${c.source}` : 'No source given: these numbers were not checked against a document.');

const WANTS_CHART = /\b(chart|graph|plot|pie|bar chart|line chart|percent(age)?s?|breakdown|distribution|trend|compare|comparison|visuali[sz]e)\b|\d\s?%/i;
/** A short instruction about charts, added to the prompt only when the message looks like it wants numbers shown. */
export const chartNote = (message: string): string => (WANTS_CHART.test(message)
  ? '\n\nTo show numbers as a chart, write a fenced block: ```chart then JSON {"type":"pie|bar|line","title":"...","unit":"...","labels":[...],"values":[...],"source":"where the numbers come from"} then ```. Use only numbers from the user, a document or a tool result; never invent them. If you have no source, leave "source" out.'
  : '');
