// Runtime + type shim for react-native-fs.
//
// The app (and the pro submodule) import this as a DEFAULT import:
//   import RNFS from 'react-native-fs';
// but the maintained fork it now resolves to, '@dr.pogodin/react-native-fs',
// is an ES module with only NAMED exports and no `default`. Aliasing the old
// specifier straight at the fork makes the default `undefined` at runtime —
// "Cannot read property 'DocumentDirectoryPath' of undefined". This shim
// re-exports the fork's named members AND provides the default the callers
// expect. metro.config.js, jest.config.js, and tsconfig.json all alias
// 'react-native-fs' to this file. See project_ios_rnfs_duplicate memory.
import * as RNFS from '@dr.pogodin/react-native-fs';
import { NativeModules, Platform } from 'react-native';

export * from '@dr.pogodin/react-native-fs';
// The upstream iOS hash reads the entire file into NSData. Model checksums must
// use the existing native streaming reader so startup scans cannot exhaust RAM.
export const hash: typeof RNFS.hash = (path, algorithm) => {
  if (Platform.OS === 'ios' && (algorithm === 'sha256' || algorithm === 'sha512')) {
    const streamingHash = NativeModules.StreamingHashModule as
      | Partial<Record<'sha256' | 'sha512', (file: string) => Promise<string>>>
      | undefined;
    const digest = streamingHash?.[algorithm];
    if (!digest) {
      return Promise.reject(
        new Error('Streaming file checksum is unavailable. Update the app and retry.'),
      );
    }
    return digest(path);
  }
  return RNFS.hash(path, algorithm);
};

const fileSystem = { ...RNFS, hash };
// Keep the default import's file-entry type used by existing model scanners.
namespace fileSystem {
  export type ReadDirResItemT = RNFS.ReadDirResItemT;
}
export default fileSystem;
