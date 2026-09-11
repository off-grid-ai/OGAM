import type { ActiveModelSnapshot, ModelModality, RuntimeModel } from '@offgrid/models';
import { modelsFailureMessage } from '@offgrid/application';
import { applicationFacade } from '../applicationFacade';

// Route reads and selection transactions only. The composed routing port itself belongs to the
// composition that builds the workspace (`modelServices/index.ts`); pulling it in here made every
// consumer of a route read depend on the workspace, which is what closed the workspace cycle.
let refreshChain = Promise.resolve<RuntimeModel[]>([]);

/** Serialize canonical inventory rebuilds so an older platform snapshot cannot win a race. */
export function refreshMobileLLMServiceInventory() {
  refreshChain = refreshChain.catch(() => []).then(async () => {
    const models = applicationFacade().models;
    const outcome = await models.refresh();
    if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    return [...models.snapshot().inventory];
  });
  return refreshChain;
}

/** Canonical Mobile selection transaction for callers below the app-service facade. */
export async function selectMobileRoute(
  modality: ModelModality,
  canonicalId: string | null,
): Promise<void> {
  await refreshMobileLLMServiceInventory();
  // The facade owns selection: it resolves the route and adopts a discovered remote model on its
  // server before committing, so callers never reach the inventory service directly.
  const selected = await applicationFacade().models.select({
    modality,
    modelId: canonicalId,
  });
  if (!selected.ok) throw new Error(selected.failure.kind === 'runtime' ? selected.failure.message : selected.failure.kind);
  await refreshMobileLLMServiceInventory();
}

export function activeMobileRoute(modality: ModelModality): ActiveModelSnapshot {
  const active = applicationFacade().models.snapshot().active[modality];
  if (!active) throw new Error(`The ${modality} model route is not initialized.`);
  return active;
}
