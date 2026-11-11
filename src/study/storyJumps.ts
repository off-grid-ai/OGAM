/**
 * The row of "jump to a story" chips for a briefing or an outlined episode. The first story starts after the greeting (line 1
 * for a briefing, line 0 otherwise); later ones are the recorded story starts. Pure, so it is tested without a device.
 */
export interface StoryJump { label: string; line: number }

const short = (t: string) => (t.length > 26 ? `${t.slice(0, 25).trimEnd()}…` : t);

export function storyJumps(r: { storyStarts?: number[]; headlines?: Array<{ title: string }> }): StoryJump[] {
  const later = r.storyStarts ?? [];
  if (!later.length) return [];
  const first = r.headlines?.length ? 1 : 0;
  const lines = [first, ...later];
  return lines.map((line, i) => ({ line, label: r.headlines?.[i]?.title ? short(r.headlines[i].title) : `Part ${i + 1}` }));
}

/** Which chip is playing now: the last story that starts at or before this line. */
export function currentStory(jumps: StoryJump[], line: number | null): number {
  if (line === null) return -1;
  let at = -1;
  jumps.forEach((j, i) => { if (j.line <= line) at = i; });
  return at;
}
