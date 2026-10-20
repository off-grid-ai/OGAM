// One-time migrations for the persisted app store.
//
// Every function here repairs state written by an OLDER build, and each is idempotent: once a value
// no longer matches the shape it is looking for, it does nothing. `DEFAULT_SETTINGS` is passed IN
// rather than imported, so the store owns its defaults and this module stays a pure transform of
// whatever it is handed. It names no store type either, so nothing here imports the store back.

/** Only the settings fields these repairs actually read. The store's own type is a superset. */
interface PersistedSettings {
  contextLength: number;
  maxTokens: number;
  liteRTMaxTokens: number;
  [key: string]: unknown;
}

interface PersistedStateMigrationContext {
  defaultSettings: PersistedSettings;
  documentsPath?: string;
}
import { Platform } from 'react-native';
import { INFERENCE_BACKENDS } from '../types';

function migrateEnabledTools(merged: any): void {
  if (
    merged.settings?.enabledTools &&
    !merged.settings.enabledTools.includes('search_knowledge_base')
  ) {
    merged.settings = {
      ...merged.settings,
      enabledTools: [...merged.settings.enabledTools, 'search_knowledge_base'],
    };
  }
}

// The removed MCP context auto-boost pinned context to 32768 (and maxTokens to 8192 /
// liteRTMaxTokens to 32768) on MCP enable and never restored it, causing OOM crashes
// and tanked tok/s on flagship devices. Reset anyone left at the boost ceiling back to
// the device-safe defaults. Idempotent: once reset, the values no longer match.
const MCP_BOOST_CTX_CEILING = 32768;
const MCP_BOOST_MAX_OUTPUT_TOKENS = 8192;
function migrateBoostedContext(
  merged: any,
  DEFAULT_SETTINGS: PersistedSettings,
): void {
  const s = merged.settings;
  if (!s) return;
  // Match the EXACT values the boost wrote, not `>=`. The boost set these to
  // precise constants; a `>=` test also clobbers a user who legitimately chose a
  // large context/maxTokens above the default, which this one-time migration must
  // not touch.
  if (s.contextLength === MCP_BOOST_CTX_CEILING) {
    s.contextLength = DEFAULT_SETTINGS.contextLength;
    // maxTokens was raised alongside contextLength by the boost; only reset it when the
    // boost's exact value is present, so a legitimately-large user maxTokens isn't clobbered.
    if (s.maxTokens === MCP_BOOST_MAX_OUTPUT_TOKENS)
      s.maxTokens = DEFAULT_SETTINGS.maxTokens;
  }
  if (s.liteRTMaxTokens === MCP_BOOST_CTX_CEILING) {
    s.liteRTMaxTokens = DEFAULT_SETTINGS.liteRTMaxTokens;
  }
}
/** 512 was the one batch default before batch became automatic (0). An install still on it
 *  never chose it, so it moves to auto and picks up 128 on HTP. Any other value was chosen. */
function migrateAutoBatch(merged: any): void {
  if (merged.settings?.nBatch === 512) merged.settings = { ...merged.settings, nBatch: 0 };
}
export function migratePersistedState<TState>(
  persistedState: any,
  currentState: TState,
  context: PersistedStateMigrationContext,
): TState {
  const { defaultSettings, documentsPath } = context;
  const merged = {
    ...currentState,
    ...persistedState,
    settings: { ...defaultSettings, ...persistedState?.settings },
  };
  // Drop legacy download tracking fields. The unified downloadStore (backed
  // by the native Room DB) is now the source of truth. Persisted entries
  // from old versions are silently ignored on rehydrate.
  delete merged.downloadProgress;
  delete merged.activeBackgroundDownloads;
  delete merged.imageModelDownloading;
  delete merged.imageModelDownloadIds;
  delete merged.imageModelDownloadId;
  // modelLoadingStrategy was removed (the residency manager owns swapping now).
  if (merged.settings?.modelLoadingStrategy !== undefined) {
    delete merged.settings.modelLoadingStrategy;
  }
  if (persistedState?.settings && !persistedState.settings.cacheType) {
    merged.settings = {
      ...merged.settings,
      cacheType: persistedState.settings.flashAttn ? 'q8_0' : 'f16',
      flashAttn: true,
    };
  }
  if (persistedState?.settings && !persistedState.settings.inferenceBackend) {
    merged.settings = {
      ...merged.settings,
      inferenceBackend:
        Platform.OS === 'ios'
          ? INFERENCE_BACKENDS.METAL
          : INFERENCE_BACKENDS.CPU,
    };
  }

  if (
    merged.checklistDismissed &&
    merged.onboardingChecklist &&
    !Object.values(merged.onboardingChecklist).every(Boolean)
  )
    merged.checklistDismissed = false;
  migrateEnabledTools(merged);
  migrateBoostedContext(merged, defaultSettings);
  migrateAutoBatch(merged);
  migrateGeneratedImageTimestamps(merged);
  migrateGeneratedImagePaths(merged, documentsPath);
  return merged as TState;
}

/** Keep generated-image paths valid when iOS gives the app a new container UUID on install. */
function migrateGeneratedImagePaths(merged: any, documentsPath?: string): void {
  if (!documentsPath || !Array.isArray(merged.generatedImages)) return;
  merged.generatedImages = merged.generatedImages.map((image: any) => {
    if (typeof image?.imagePath !== 'string') return image;
    const match =
      /\/Containers\/Data\/Application\/[^/]+\/Documents\/(generated_images\/.+)$/.exec(
        image.imagePath,
      );
    return match
      ? { ...image, imagePath: `${documentsPath}/${match[1]}` }
      : image;
  });
}

/**
 * Generated images stamped with epoch milliseconds as text, put right.
 *
 * The Android image module wrote `"1786317315833"`, which satisfies `createdAt: string` and is a date
 * to nobody: the gallery showed it as invalid, and every sync peer refused the image because
 * `Date.parse` answers NaN. The producers now write ISO-8601, but a phone that has generated images
 * already holds the old value, and nothing else would ever rewrite it.
 */
function migrateGeneratedImageTimestamps(merged: any): void {
  if (!Array.isArray(merged.generatedImages)) return;
  merged.generatedImages = merged.generatedImages.map((image: any) => {
    const epochMs = Number(image?.createdAt);
    return typeof image?.createdAt === 'string' &&
      /^\d+$/.test(image.createdAt) &&
      Number.isFinite(epochMs)
      ? { ...image, createdAt: new Date(epochMs).toISOString() }
      : image;
  });
}
