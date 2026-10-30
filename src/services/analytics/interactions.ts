/**
 * The light seam UI code reports interactions through: a press, a long-press, a switch, an error
 * shown, a scroll. It imports no SDK and no store, so every touchable can use it. The analytics owner
 * plugs in a sink only while Anonymous stats is on; before that each call is a no-op.
 */
import { normalizeActionId } from './actionIds';
import { scrollBucket, type ScrollBucket, type SummaryCounter } from './sessionTally';

export interface InteractionSink {
  count(counter: SummaryCounter, key: string): void;
  scrolled(pct: ScrollBucket): void;
}

let sink: InteractionSink | null = null;

export function setInteractionSink(next: InteractionSink | null): void {
  sink = next;
}

/** A tap on a control, by its testID. */
export function countPress(testID: string | null | undefined): void {
  if (!sink) return;
  const id = normalizeActionId(testID);
  if (id) sink.count('actions', id);
}

export function countLongPress(testID: string | null | undefined): void {
  if (!sink) return;
  const id = normalizeActionId(testID);
  if (id) sink.count('long_press', id);
}

/** An error the person saw. `where` is a fixed code or the screen it showed on. */
export function countErrorShown(where: string): void {
  sink?.count('errors_shown', where);
}

/** How far down the screen's main list the person is (0..1). */
export function reportScroll(fraction: number): void {
  sink?.scrolled(scrollBucket(fraction));
}
