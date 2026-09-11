// Composition root: the shared image use case over Mobile's image ports, reached through the
// FACADE's `imageGeneration` seam instead of a held ModelWorkspace.
//
// The facade caches one owner per application root. Resolve it on each call because Fast Refresh
// replaces that root; retaining an owner here would let the Models sheet read the new selection
// while image generation still reads an old, empty model workspace.
import { applicationFacade } from '../applicationFacade';
import { mobileImageGenerationApplicationPorts } from '../modelServices/imageGenerationApplication';

export const imageGenerationApplication = () =>
  applicationFacade().models.imageGeneration(
    mobileImageGenerationApplicationPorts(),
  );
