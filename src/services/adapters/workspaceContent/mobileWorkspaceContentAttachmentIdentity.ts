import {
  projectWorkspaceContentAttachmentByteIdentities,
  type LocalMessageContentLocation,
  type MessageRecord,
  type WorkspaceContentAttachmentLocationInput,
  type WorkspaceContentAttachmentIdentityFailure,
  type WorkspaceContentAttachmentByteIdentity,
  type Outcome,
} from '@offgrid/application';

/**
 * Adapt Mobile's persisted location union to the one Shared attachment-identity policy.
 *
 * Current rows name an attachment by stable contentId. Rows written before that migration name the
 * same attachment by its portable-content index. Shared validates both shapes and resolves them to
 * one stable byte identity; Mobile only supplies the persisted platform values.
 */
export function projectMobileWorkspaceContentAttachmentByteIdentities(
  message: Pick<MessageRecord, 'portable' | 'local'>,
): Outcome<
  readonly WorkspaceContentAttachmentByteIdentity[],
  WorkspaceContentAttachmentIdentityFailure
> {
  return projectWorkspaceContentAttachmentByteIdentities({
    portable: message.portable,
    locations: (message.local?.contentLocations ?? []).map(
      mobileAttachmentLocationInput,
    ),
  });
}

function mobileAttachmentLocationInput(
  location: LocalMessageContentLocation,
): WorkspaceContentAttachmentLocationInput {
  return typeof location.contentId === 'string'
    ? {
        kind: 'canonical',
        location: location as Extract<
          LocalMessageContentLocation,
          { contentId: string }
        >,
      }
    : {
        kind: 'legacy_index',
        location: location as Extract<
          LocalMessageContentLocation,
          { index: number }
        >,
      };
}
