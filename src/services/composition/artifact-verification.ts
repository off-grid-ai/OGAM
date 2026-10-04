// Composition root: shared artifact verification over Mobile's filesystem port. It owns the one
// verification instance every runtime caller uses, so no adapter has to reach back into a
// composition module for it.
import { ArtifactVerificationService, once } from '@offgrid/models';
import { mobileArtifactVerificationFiles } from '../adapters/models/artifactVerificationFilePort';

/** Verification over the React Native filesystem; a caller may add a checksum port. */
export const artifactVerification = once(
  () => new ArtifactVerificationService(mobileArtifactVerificationFiles),
);

export function artifactVerificationWith(
  extra: Partial<ConstructorParameters<typeof ArtifactVerificationService>[0]>,
): ArtifactVerificationService {
  return new ArtifactVerificationService({ ...mobileArtifactVerificationFiles, ...extra });
}
