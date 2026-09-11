import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import type {
  PersistedProjectorRepair,
  ProjectorRepairPlatformPort,
} from '@offgrid/application';
import { APP_CONFIG } from '../../constants';
import type { DownloadedModel } from '../../types';
import {
  commitModelsList,
  loadDownloadedModels,
} from '../adapters/models/library/modelRegistryStorageAdapter';
import {
  DownloadInstallTransaction,
  installRecoveryMoves,
  parseInstallRecoveryState,
} from './downloadInstallTransaction';

const JOURNAL_KEY = '@offgrid/projector_repairs_v1';
const MAX_JOURNAL_BYTES = 1_000_000;

const cancelled = (): Error => new Error('Projector repair cancelled');
const modelsDirectory = () => `${RNFS.DocumentDirectoryPath}/${APP_CONFIG.modelStorageDir}`;
const absolute = (localName: string) => `${RNFS.DocumentDirectoryPath}/${localName}`;

const journal: ProjectorRepairPlatformPort['journal'] = {
  async read() {
    const stored = await AsyncStorage.getItem(JOURNAL_KEY);
    if (!stored) return [];
    if (stored.length > MAX_JOURNAL_BYTES) {
      throw new Error('The projector repair journal is too large.');
    }
    const parsed: unknown = JSON.parse(stored);
    // Shared validates every record. Keep a malformed top-level value visible as one bad row
    // instead of silently treating corruption as an empty, successful recovery.
    return Array.isArray(parsed) ? parsed : [parsed];
  },
  async write(records) {
    if (records.length === 0) {
      await AsyncStorage.removeItem(JOURNAL_KEY);
      return;
    }
    await AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify(records));
  },
};

function updatedModels(input: {
  readonly models: readonly DownloadedModel[];
  readonly repair: PersistedProjectorRepair;
  readonly installedPath: string;
  readonly installedSize: number;
}): DownloadedModel[] {
  const { models, repair, installedPath, installedSize } = input;
  let found = false;
  const next = models.map(model => {
    if (model.id !== repair.modelId) return model;
    if (model.engine !== 'llama' || model.fileName !== repair.primaryFileName) {
      throw new Error('The projector repair target does not match the installed model.');
    }
    found = true;
    return {
      ...model,
      isVisionModel: true,
      mmProjPath: installedPath,
      mmProjFileName: repair.installedLocalName.split('/').pop() ?? repair.projector.fileName,
      mmProjFileSize: installedSize,
    };
  });
  if (!found) throw new Error('The projector repair target is not installed.');
  return next;
}

async function beginProjectorFinalization(repair: PersistedProjectorRepair) {
  const previousModels = await loadDownloadedModels(modelsDirectory());
  const source = absolute(repair.stagingLocalName);
  const destination = absolute(repair.installedLocalName);
  const transaction = new DownloadInstallTransaction({
    version: 1,
    moves: (await installRecoveryMoves([{ source, destination }])).map(move => ({
      ...move,
      discardSourceOnRollback: true,
    })),
    priorTextModels: previousModels,
  }, models => commitModelsList([...models]));
  return {
    recoveryState: transaction.recoveryState,
    async prepare(signal: AbortSignal) {
      if (signal.aborted) throw cancelled();
      await transaction.move(0);
      if (signal.aborted) throw cancelled();
      const stat = await RNFS.stat(destination);
      const size = typeof stat.size === 'string' ? Number.parseInt(stat.size, 10) : stat.size;
      await commitModelsList(updatedModels({
        models: previousModels,
        repair,
        installedPath: destination,
        installedSize: size,
      }));
      if (signal.aborted) throw cancelled();
      return { localName: repair.installedLocalName };
    },
    commit: () => transaction.commit(),
    rollback: () => transaction.rollback(),
  };
}

/** Mobile file and registry I/O. Shared owns repair policy, transfer, validation, and lifecycle. */
export const mobileProjectorRepairPlatformPort: ProjectorRepairPlatformPort = {
  journal,
  finalizer: {
    async recover(input) {
      const transaction = new DownloadInstallTransaction(
        parseInstallRecoveryState(input.state),
        models => commitModelsList([...models]),
      );
      if (input.disposition === 'commit') await transaction.commit();
      else await transaction.rollback();
    },
    begin: beginProjectorFinalization,
  },
};
