// Composition root: the shared image use case over Mobile's image ports, reached through the
// FACADE's `imageGeneration` seam instead of a held ModelWorkspace.
//
// `once` is kept even though the facade also builds the owner once per root. The seam holds the
// in-flight operation, its abort controller and the snapshot every surface renders, so there must
// be exactly one - and calling the factory again here would rebuild the ports bundle for a seam
// the facade would hand back unchanged. Two guards on one invariant, cheaply, at the place that
// would otherwise look like it could be called twice.
import { once } from '@offgrid/models';
import { applicationFacade } from '../applicationFacade';
import { mobileImageGenerationApplicationPorts } from '../modelServices/imageGenerationApplication';

export const imageGenerationApplication = once(() =>
  applicationFacade().models.imageGeneration(
    mobileImageGenerationApplicationPorts(),
  ),
);
