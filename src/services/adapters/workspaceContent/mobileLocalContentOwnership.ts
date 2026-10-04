import type { GeneratedImageRecord, MessageRecord } from '@offgrid/application';
import {
  projectMobileWorkspaceContentAttachmentByteIdentities,
} from './mobileWorkspaceContentAttachmentIdentity';

export type MobileOwnedByteIdentity = `file:${string}` | `gallery:${string}`;

/**
 * Project one canonical gallery record onto the stable identities that messages can retain.
 *
 * The record is the Shared owner's row, not a retired app-store projection: `local.path` is the
 * device-only byte fact Shared never opens, and it is validated here before any deletion decision
 * is made from it.
 */
export function mobileGalleryRecordByteIdentities(
  record: GeneratedImageRecord,
): ReadonlySet<MobileOwnedByteIdentity> {
  const id = requiredText(record.id, 'generated image id');
  const filePath = absoluteFilePath(
    record.local?.path,
    'generated image path',
    true,
  );
  return new Set([
    `gallery:${id}`,
    `file:${filePath}`,
  ] as MobileOwnedByteIdentity[]);
}

/**
 * Resolve every local byte reference retained by canonical Workspace Content messages.
 * Malformed or unknown local-location shapes reject before cleanup can touch a file.
 *
 * `retains` names which messages still SURVIVE the caller's operation. Validation always runs over
 * the whole transcript, so one malformed shape anywhere fails the operation closed, but only a
 * surviving message can protect bytes. A message that is itself being deleted must never retain
 * the media it is being deleted with, or the deletion could never remove its own images.
 */
export function retainedMobileMessageByteIdentities(
  messages: readonly MessageRecord[],
  retains: (message: MessageRecord) => boolean = () => true,
): ReadonlySet<MobileOwnedByteIdentity> {
  const identities = new Set<MobileOwnedByteIdentity>();
  for (const message of messages) {
    const retained = retains(message);
    const content = message.portable.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'image' && (part.contentId || part.id)) {
          if (part.contentId && part.id && part.contentId !== part.id) {
            throw new Error(
              `Message ${message.id} has conflicting image content identities.`,
            );
          }
          const label = `message ${message.id} image content identity`;
          const identity =
            `gallery:${requiredText(part.contentId ?? part.id, label)}` as const;
          if (retained) identities.add(identity);
        }
      }
    }

    const local = message.local;
    if (!local) continue;
    rejectUnknownLegacyLocations(local, message.id);
    const audioPath = local.audioPath;
    if (audioPath !== undefined) {
      const label = `message ${message.id} audioPath`;
      const identity =
        `file:${absoluteFilePath(audioPath, label, true)}` as const;
      if (retained) identities.add(identity);
    }

    if (local.contentLocations !== undefined) {
      const projected = projectMobileWorkspaceContentAttachmentByteIdentities(
        message,
      );
      if (!projected.ok) throw new Error(projected.failure.message);
      for (const location of projected.value) {
        if (retained && location.uri !== undefined) {
          identities.add(
            `file:${absoluteFilePath(
              location.uri,
              `message ${message.id} local content URI`,
              true,
            )}`,
          );
        }
      }
    }
  }
  return identities;
}

function rejectUnknownLegacyLocations(
  local: NonNullable<MessageRecord['local']>,
  messageId: string,
): void {
  for (const key of Object.keys(local)) {
    if (key === 'contentLocations' || key === 'audioPath') continue;
    if (/(?:attachments?|paths?|uris?|locations?)$/i.test(key)) {
      throw new Error(
        `Message ${messageId} has unsupported legacy local media field ${key}.`,
      );
    }
  }
}

function absoluteFilePath(
  value: unknown,
  label: string,
  allowLegacyAbsolutePath: boolean,
): string {
  const text = requiredText(value, label);
  let path: string;
  if (text.startsWith('file://')) {
    try {
      path = decodeURIComponent(text.slice('file://'.length));
    } catch {
      throw new Error(`${label} is not a valid file URI.`);
    }
  } else if (allowLegacyAbsolutePath && text.startsWith('/')) {
    path = text;
  } else {
    throw new Error(`${label} does not prove Mobile owns local file bytes.`);
  }
  if (!path.startsWith('/') || path.includes('\0')) {
    throw new Error(`${label} is not an absolute local file path.`);
  }
  return path;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is not non-empty text.`);
  }
  return value;
}
