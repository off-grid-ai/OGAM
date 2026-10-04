/**
 * Mobile boundary for Shared classifier provisioning.
 * Shared owns concurrency, artifact choice, download/select decisions, and recovery.
 */
import type { ClassifierProvisioningService } from '@offgrid/models';
import type { ModelFile } from '../types';
import { classifierProvisioning } from './composition/model-library';
import type { ClassifierModel } from './classifierProvisioningPorts';

const service = (): ClassifierProvisioningService<ModelFile, ClassifierModel> => classifierProvisioning();

export function ensureDefaultClassifier(): Promise<void> {
  return service().ensure();
}
