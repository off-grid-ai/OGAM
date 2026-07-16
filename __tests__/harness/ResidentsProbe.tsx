/**
 * ResidentsProbe — a TEST-ONLY UI surface for the model residency set.
 *
 * The resident set (`modelResidencyManager.getResidents()` — what is actually in RAM) has no prod UI
 * surface: the user perceives it only indirectly (memory pressure, a wrong "Not Enough Memory" card).
 * Residency-invariant reds (T022/T023/T025/T026/T030) need to ASSERT ON THE UI what is resident, so this
 * renders the real residency projection as a queryable `testID="probe-residents"` string.
 *
 * It lives in the harness (NOT src) so it adds ZERO production surface — the test renders it ALONGSIDE the
 * real screen under test. It reads the REAL singleton `modelResidencyManager` (the same instance the
 * screens/services mutate, because the test requires this after installNativeBoundary()'s resetModules),
 * and subscribes to the reactive stores that change WHENEVER residency changes (a load flips
 * whisper.isModelLoaded / appStore.activeModelId / activeImageModelId; an eject clears them) so the
 * rendered text re-renders in step with the residency map, which is itself a plain (non-reactive) Map.
 *
 * Output: a comma-separated, sorted list of resident TYPES (e.g. "text,whisper"), or "(none)". Assert with
 * getByTestId('probe-residents').props.children.
 */
import React from 'react';
import { Text } from 'react-native';
// Required AFTER installNativeBoundary() → resolves the same fresh module graph the screens use.
import { modelResidencyManager } from '../../src/services/modelResidency';

export const ResidentsProbe: React.FC = () => {
  // `modelResidencyManager` holds a plain (non-reactive) Map, and residency changes (load / eject /
  // release / eviction) do NOT all coincide with a reactive store change — an eject that frees a sidecar
  // touches no store the UI subscribes to. So POLL the real residency on a short interval and re-render:
  // getByTestId then always reads a FRESH read, never a stale precondition render. Test-only, so the poll
  // is fine; waitFor (1s) comfortably catches a 25ms tick. This is what lets a fix flip the probe green.
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 25);
    return () => clearInterval(id);
  }, []);

  const types = modelResidencyManager
    .getResidents()
    .map((r) => r.type)
    .sort()
    .join(',');

  return <Text testID="probe-residents">{types || '(none)'}</Text>;
};
