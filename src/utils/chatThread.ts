// A chat as a thread of versions (chat-thread.ts in @offgrid/sync, the rule every surface shares).
// Each message follows a parent; messages with the same parent are versions of each other, and the
// latest-chosen one is shown. Retrying, resending or editing adds a version and deletes nothing.
import {
  appendPlace,
  chatThread,
  neighbourVersion,
  parentOfVersion,
} from '@offgrid/sync';
import type { Message } from '../types';

const threadRows = (messages: readonly Message[]) =>
  messages.map(message => ({
    message,
    uuid: message.uuid ?? message.id,
    ...(message.parent ? { parent: message.parent } : {}),
    ...(message.selectedAt !== undefined ? { selectedAt: message.selectedAt } : {}),
  }));

/**
 * The messages the chat shows and sends as history, each with its place among its versions.
 * `until`: a retry's new answer is being made after this message, so the thread ends there (the
 * old answer and its later turns stay a version, out of the way meanwhile).
 */
export function shownMessages(messages: readonly Message[], until?: string): Message[] {
  const thread = chatThread(threadRows(messages));
  const end = until === undefined ? -1 : thread.messages.findIndex(({ uuid }) => uuid === until);
  const shown = end >= 0 ? thread.messages.slice(0, end + 1) : thread.messages;
  return shown.map(({ message, uuid }) => {
    const versions = thread.versions.get(uuid);
    return versions
      ? { ...message, threadVersions: { index: versions.index, count: versions.count } }
      : message.threadVersions
        ? { ...message, threadVersions: undefined }
        : message;
  });
}

/** What a message appended at the end stores: its parent, only once the chat has versions. */
export function appendPlaceFor(messages: readonly Message[]): { parent?: string } {
  return appendPlace(threadRows(messages));
}

/** The parent a new version of `message` takes, or undefined when it is not in the chat. */
export function versionParent(
  messages: readonly Message[],
  message: Pick<Message, 'id' | 'uuid'>,
): string | undefined {
  return parentOfVersion(threadRows(messages), message.uuid ?? message.id);
}

/** The id of the version `direction` steps from shown `message` (-1 older, +1 newer). */
export function neighbourMessage(
  messages: readonly Message[],
  message: Pick<Message, 'id' | 'uuid'>,
  direction: number,
): Message | undefined {
  const target = neighbourVersion(threadRows(messages), message.uuid ?? message.id, direction);
  return messages.find(candidate => (candidate.uuid ?? candidate.id) === target);
}
