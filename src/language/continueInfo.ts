import { boardFor, spaceOpen } from './board';
import { useLanguage } from './store';
import { LANGUAGES } from './languageService';

/** Where the learner is in the course: the next square on the board, or null when they have not started. */
export function continueInfo(): { language: string; title: string; kind: string } | null {
  const { language: code, level, progress, xp } = useLanguage.getState();
  const started = xp > 0 || Object.keys(progress[code] ?? {}).length > 0;
  if (!started) return null;
  const spaces = boardFor(level);
  const done = (key: string) => (progress[code]?.[key]?.stars ?? 0) > 0;
  const next = spaces.find((s, i) => !done(s.key) && spaceOpen(spaces, i, done));
  if (!next) return null;
  return { language: LANGUAGES.find((l) => l.code === code)?.name ?? code, title: next.title, kind: next.kind };
}
