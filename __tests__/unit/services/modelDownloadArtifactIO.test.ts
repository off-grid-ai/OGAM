import type { DownloadFilePort, DownloadTransferPort } from '@offgrid/models';
import {
  compositeDownloadFilePort,
  compositeDownloadTransferPort,
  type MobileManagedArtifactIO,
} from '../../../src/services/modelServices/modelDownloadArtifactIO';

function nativePort(stop?: DownloadTransferPort['stop']): DownloadTransferPort {
  return {
    start: jest.fn(),
    stop,
  };
}

function managedIO(input: {
  ownsTransfer: boolean;
  ownsPath?: boolean;
  stop?: MobileManagedArtifactIO['stop'];
}): MobileManagedArtifactIO {
  return {
    ownsArtifact: () => false,
    ownsTransfer: () => input.ownsTransfer,
    ownsPath: () => input.ownsPath ?? false,
    ownsModel: () => false,
    start: jest.fn(),
    stop: input.stop,
    exists: jest.fn(),
    size: jest.fn(),
    remove: jest.fn(),
    removeModel: jest.fn(),
    beginFinalization: jest.fn(),
    recoverFinalization: jest.fn(),
  };
}

function filePort(remove: DownloadFilePort['remove']): DownloadFilePort {
  return {
    pathFor: path => path,
    exists: jest.fn(),
    size: jest.fn(),
    remove,
  };
}

describe('compositeDownloadTransferPort stop policy', () => {
  const request = {
    transferId: 'transfer-1',
    disposition: 'delete-partial' as const,
  };

  it('passes the explicit disposition to the native owner', async () => {
    const stop = jest.fn(async () => ({ outcome: 'stopped' as const }));
    const port = compositeDownloadTransferPort(nativePort(stop));

    await expect(port.stop!(request)).resolves.toEqual({ outcome: 'stopped' });
    expect(stop).toHaveBeenCalledWith(request);
  });

  it('passes the explicit disposition to the managed owner', async () => {
    const nativeStop = jest.fn(async () => ({ outcome: 'stopped' as const }));
    const managedStop = jest.fn(async () => ({ outcome: 'completed' as const }));
    const port = compositeDownloadTransferPort(
      nativePort(nativeStop),
      managedIO({ ownsTransfer: true, stop: managedStop }),
    );

    await expect(port.stop!(request)).resolves.toEqual({ outcome: 'completed' });
    expect(managedStop).toHaveBeenCalledWith(request);
    expect(nativeStop).not.toHaveBeenCalled();
  });

  it('refuses a managed transport that cannot apply the policy', async () => {
    const port = compositeDownloadTransferPort(
      nativePort(jest.fn()),
      managedIO({ ownsTransfer: true }),
    );

    await expect(port.stop!(request)).rejects.toThrow(
      'This managed download cannot apply the requested stop policy.',
    );
  });

  it('does not advertise recovery capabilities that neither adapter implements', () => {
    const port = compositeDownloadTransferPort(nativePort());

    expect(port.attach).toBeUndefined();
    expect(port.isActive).toBeUndefined();
    expect(port.stop).toBeUndefined();
  });
});

describe('compositeDownloadFilePort partial cleanup', () => {
  it('forwards native partial cleanup through the canonical remove path', async () => {
    const nativeRemove = jest.fn(async () => {});
    const port = compositeDownloadFilePort(filePort(nativeRemove));

    await port.removePartial!('/native/model.part');

    expect(nativeRemove).toHaveBeenCalledWith('/native/model.part');
  });

  it('routes managed partial cleanup through the same canonical remove path', async () => {
    const nativeRemove = jest.fn(async () => {});
    const managed = managedIO({ownsTransfer: false, ownsPath: true});
    const port = compositeDownloadFilePort(filePort(nativeRemove), managed);

    await port.removePartial!('/managed/model.part');

    expect(managed.remove).toHaveBeenCalledWith('/managed/model.part');
    expect(nativeRemove).not.toHaveBeenCalled();
  });
});
