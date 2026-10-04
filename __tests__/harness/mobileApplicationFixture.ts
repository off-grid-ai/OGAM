import type { ModelsSnapshot, OffGridApplication } from '@offgrid/application';
import type { ModelModality } from '@offgrid/models';
import type { PersistedModelDownload } from '@offgrid/models';
import { doMockRealSqlite } from './sqliteFake';

const DOWNLOAD_JOURNAL_KEY = '@offgrid/model_downloads_v2';

/** Seed the durable native boundary that the real Shared coordinator recovers at startup. */
export async function seedMobileDownloadJournal(
  records: readonly PersistedModelDownload[],
): Promise<void> {
  const storage = require('@react-native-async-storage/async-storage');
  await storage.setItem(DOWNLOAD_JOURNAL_KEY, JSON.stringify(records));
}

export interface MobileApplicationFixture {
  readonly application: OffGridApplication;
  refreshModels(): Promise<ModelsSnapshot>;
  selectedModelId(modality: ModelModality): string;
  restart(): Promise<void>;
  dispose(): Promise<void>;
}

let current: MobileApplicationFixture | null = null;
let consumed = false;

/** Starts the real Mobile composition root in the module graph created by installNativeBoundary(). */
export async function startMobileApplicationFixture(
  options: { readonly pro?: boolean } = {},
): Promise<MobileApplicationFixture> {
  if (current) return current;
  if (consumed) {
    throw new Error(
      'Install a fresh native boundary before restarting the Mobile application fixture.',
    );
  }
  consumed = true;

  if (options.pro) {
    const { installPro } =
      require('./proHarness') as typeof import('./proHarness');
    await installPro();
  }

  // The application root owns durable SQLite repositories. Use a real in-memory
  // database for their migrations and queries; the global empty-row native stub
  // cannot represent schema state.
  doMockRealSqlite();

  const composition =
    require('../../src/services/composition/application') as typeof import('../../src/services/composition/application');
  let application = composition.getMobileApplication();
  let disposal: Promise<void> | null = null;

  const refreshModels = async (): Promise<ModelsSnapshot> => {
    const outcome = await application.models.refresh();
    if (!outcome.ok)
      throw new Error(`Model refresh failed: ${outcome.failure.kind}`);
    return outcome.value;
  };

  const fixture: MobileApplicationFixture = {
    get application() {
      return application;
    },
    refreshModels,
    selectedModelId(modality) {
      const modelId = application.models.snapshot().active[modality]?.model?.id;
      if (!modelId) throw new Error(`No ${modality} model is selected.`);
      return modelId;
    },
    async restart() {
      await composition.stopMobileApplication();
      application = composition.getMobileApplication();
      await composition.startMobileApplication();
      await refreshModels();
    },
    dispose() {
      if (disposal) return disposal;
      disposal = (async () => {
        try {
          await composition.stopMobileApplication();
        } finally {
          if (current === fixture) current = null;
        }
      })();
      return disposal;
    },
  };

  try {
    await composition.startMobileApplication();
    await fixture.refreshModels();
    current = fixture;
    return fixture;
  } catch (error) {
    await fixture.dispose();
    throw error;
  }
}

export function currentMobileApplicationFixture(): MobileApplicationFixture | null {
  return current;
}
