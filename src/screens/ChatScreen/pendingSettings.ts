import { hasPendingTextEngineSettings } from '@offgrid/application';

/**
 * Whether live settings differ from what the loaded model was loaded with.
 * A field only counts as changed when the load snapshot captured it.
 */
export function computePendingSettings(
  engine: string | undefined,
  settings: Record<string, unknown>,
  loadedSettings: Record<string, unknown> | null | undefined,
): boolean {
  return hasPendingTextEngineSettings({ engine, settings, loadedSettings });
}
