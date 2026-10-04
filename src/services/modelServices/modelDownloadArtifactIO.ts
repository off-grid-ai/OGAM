import type {
  AsyncDownloadedModelRegistryPort,
  DownloadFilePort,
  DownloadFinalizationTransaction,
  DownloadTransferPort,
  PersistedModelDownload,
} from '@offgrid/models';

type TransferStart = Parameters<DownloadTransferPort['start']>[0];
type TransferAttach = Parameters<NonNullable<DownloadTransferPort['attach']>>[0];
type TransferStopFunction = NonNullable<DownloadTransferPort['stop']>;
type TransferStop = Parameters<TransferStopFunction>[0];
type TransferStopResult = Awaited<ReturnType<TransferStopFunction>>;

/**
 * One optional platform-managed artifact strategy, supplied before application composition.
 * It owns only native I/O. Queueing, retry, persistence, and projection stay in ModelsFacade.
 */
export interface MobileManagedArtifactIO {
  ownsArtifact(id: string): boolean;
  ownsTransfer(transferId: string): boolean;
  ownsPath(path: string): boolean;
  ownsModel(modelId: string): boolean;
  start(input: TransferStart): Promise<{ transferId?: string }>;
  attach?(input: TransferAttach): Promise<void>;
  isActive?(transferId: string): Promise<boolean>;
  stop?(input: TransferStop): Promise<TransferStopResult>;
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number>;
  remove(path: string): Promise<void>;
  removeModel(modelId: string): Promise<void>;
  beginFinalization(download: Readonly<PersistedModelDownload>): Promise<DownloadFinalizationTransaction>;
  recoverFinalization(input: {
    download: Readonly<PersistedModelDownload>;
    state: string;
    disposition: 'rollback' | 'commit';
  }): Promise<void>;
  /** Canonical durable registration for managed artifacts that do not use Mobile's text/image rows. */
  downloadedRegistry?: Pick<
    Extract<AsyncDownloadedModelRegistryPort, { capture: unknown }>,
    'capture' | 'apply' | 'restore' | 'contains'
  >;
}

export function compositeDownloadTransferPort(
  native: DownloadTransferPort,
  managed?: MobileManagedArtifactIO,
): DownloadTransferPort {
  const attach = native.attach || managed?.attach
    ? async (input: TransferAttach): Promise<void> => {
      if (managed?.ownsTransfer(input.transferId)) {
        if (!managed.attach) throw new Error('This managed download cannot attach after restart.');
        await managed.attach(input);
        return;
      }
      if (!native.attach) throw new Error('This native download cannot attach after restart.');
      await native.attach(input);
    }
    : undefined;
  const isActive = native.isActive || managed?.isActive
    ? (transferId: string): Promise<boolean> => managed?.ownsTransfer(transferId)
      ? managed.isActive?.(transferId) ?? Promise.resolve(false)
      : native.isActive?.(transferId) ?? Promise.resolve(false)
    : undefined;
  const stop = native.stop || managed?.stop
    ? async (input: TransferStop): Promise<TransferStopResult> => {
      if (managed?.ownsTransfer(input.transferId)) {
        if (!managed.stop) throw new Error('This managed download cannot apply the requested stop policy.');
        return managed.stop(input);
      }
      if (!native.stop) throw new Error('This native download cannot apply the requested stop policy.');
      return native.stop(input);
    }
    : undefined;
  return {
    start: input => managed?.ownsArtifact(input.id)
      ? managed.start(input)
      : native.start(input),
    attach,
    isActive,
    stop,
  };
}

export function compositeDownloadFilePort(
  native: DownloadFilePort,
  managed?: MobileManagedArtifactIO,
): DownloadFilePort {
  const remove = (path: string): Promise<void> =>
    managed?.ownsPath(path) ? managed.remove(path) : native.remove(path);
  return {
    pathFor: localName => native.pathFor(localName),
    exists: path => managed?.ownsPath(path) ? managed.exists(path) : native.exists(path),
    size: path => managed?.ownsPath(path) ? managed.size(path) : native.size(path),
    readPrefix: native.readPrefix
      ? (path, bytes) => native.readPrefix!(path, bytes)
      : undefined,
    sha256: native.sha256
      ? path => native.sha256!(path)
      : undefined,
    remove,
    removePartial: remove,
  };
}
