import { create } from 'zustand';

/** A reply's start as a quote to put in front of a question ("> line" for each line, then a blank line). */
export function quoteForAsk(text: string, max = 400): string {
  const clean = text.trim();
  if (!clean) return '';
  const cut = clean.length > max ? `${clean.slice(0, max).replace(/\s+\S*$/, '')}...` : clean;
  return `${cut.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')}\n\n`;
}

/** The quote waiting to be put in the message box; the box takes it and clears it. */
export const useQuoteDraft = create<{ text: string; set: (text: string) => void }>((set) => ({ text: '', set: (text) => set({ text }) }));
