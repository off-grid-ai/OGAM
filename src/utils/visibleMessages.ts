import { chatListPreviewLine } from '@offgrid/sync';
import type { Message } from '../types';

/**
 * What a user actually sees of a conversation.
 *
 * One owner, because the answer has to be the same everywhere it is asked. The chat screen asks
 * it to draw the thread; four list screens ask it to draw a preview row. When they each answered
 * for themselves, hiding a message in the chat left it quoted on the home screen as the last
 * thing said - the conversation disagreeing with its own summary.
 */

/**
 * Runtime notices another device wrote are dropped.
 *
 * "Model loaded: Qwythos 9B (3.1s)" is a fact about the machine that loaded it. Synced verbatim it
 * becomes a false statement everywhere else: a phone claiming it loaded a model it never loaded,
 * at a speed it never reached. Nothing is deleted - the notice still syncs, and the device that
 * wrote it still shows it - it is simply not repeated where it is not true.
 *
 * A device's own notices carry provenance too, once the record round-trips through sync, so the
 * presence of provenance is not the test. The origin has to be compared with this device.
 *
 * With no local device id (free builds, or before the mesh has named this device) nothing is
 * hidden: without an identity there is no way to tell whose notice it is, and showing a true
 * notice is a smaller error than hiding one.
 */
export function visibleMessages(
  messages: readonly Message[],
  localDeviceId: string | null | undefined,
): readonly Message[] {
  if (!localDeviceId) return messages;
  return messages.filter(
    message =>
      !message.isSystemInfo ||
      !message.provenance ||
      message.provenance.originDeviceId === localDeviceId,
  );
}

/** The most recent message a user would see, which is what a list row summarises. */
function lastVisibleMessage(
  messages: readonly Message[],
  localDeviceId: string | null | undefined,
): Message | undefined {
  const visible = visibleMessages(messages, localDeviceId);
  return visible[visible.length - 1];
}

/**
 * The one-line summary of a conversation for any list that shows one.
 *
 * The wording comes from the shared rule (`chatListPreviewLine`), so a conversation reads the
 * same in this app's four lists and on the Mac. Three of those lists used to build the line by
 * hand - `role === 'user' ? 'You: ' : ''` and the raw content - which meant a pasted code block
 * blew the row's height apart and a long reply was never cut, in some lists but not others.
 */
export function conversationPreviewLine(
  messages: readonly Message[],
  localDeviceId: string | null | undefined,
): string {
  const last = lastVisibleMessage(messages, localDeviceId);
  return plainMath(chatListPreviewLine(last?.role, last?.content));
}

/**
 * A one-line preview reads maths as text: "$37 \times 43$" becomes "37 × 43" (hand test 19 saw the
 * raw LaTeX in a project's chat list). Only the common inline forms; the chat itself still renders it.
 */
export function plainMath(text: string): string {
  // Only text that holds LaTeX: a price like "$5" keeps its dollar sign.
  if (!/\\[a-zA-Z()[\]]/.test(text)) return text;
  return text
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')
    .replace(/\\times/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\cdot/g, '·')
    .replace(/\\(left|right)/g, '')
    .replace(/\\[()[\]]/g, '')
    .replace(/\$+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
