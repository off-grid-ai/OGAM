import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

/** Where one pack is on its way to the phone. The same contract on every platform; a platform with no
 *  pack system answers "not_installed" for every pack. */
export type PackStatus =
  | 'not_installed'
  | 'unknown'
  | 'pending'
  | 'downloading'
  | 'transferring'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'waiting_for_wifi'
  | 'requires_confirmation';

export interface PackState {
  name: string;
  status: PackStatus;
  bytesDownloaded: number;
  totalBytes: number;
  errorCode: number;
  /** The folder that holds the pack's files once it has arrived; null before. */
  assetsPath: string | null;
}

export interface BundledModelPort {
  getPacks(names: readonly string[]): Promise<Record<string, PackState>>;
  fetch(names: readonly string[]): Promise<Record<string, PackState>>;
  removePack(name: string): Promise<boolean>;
  onPack(listener: (state: PackState) => void): () => void;
}

const EVENT = 'BundledModelPack';

function absent(names: readonly string[]): Record<string, PackState> {
  return Object.fromEntries(names.map(name => [name, {
    name, status: 'not_installed' as const, bytesDownloaded: 0, totalBytes: 0, errorCode: 0, assetsPath: null,
  }]));
}

/** No pack system on this platform yet (iOS before its asset pack lands): nothing ever arrives. */
const noPacks: BundledModelPort = {
  getPacks: async names => absent(names),
  fetch: async names => absent(names),
  removePack: async () => false,
  onPack: () => () => {},
};

function nativePort(native: {
  getPacks(names: string[]): Promise<Record<string, PackState>>;
  fetch(names: string[]): Promise<Record<string, PackState>>;
  removePack(name: string): Promise<boolean>;
}): BundledModelPort {
  const emitter = new NativeEventEmitter(native as never);
  return {
    getPacks: names => native.getPacks([...names]),
    fetch: names => native.fetch([...names]),
    removePack: name => native.removePack(name),
    onPack: listener => {
      const sub = emitter.addListener(EVENT, listener);
      return () => sub.remove();
    },
  };
}

export const bundledModelPort: BundledModelPort =
  Platform.OS === 'android' && NativeModules.BundledModel ? nativePort(NativeModules.BundledModel) : noPacks;
