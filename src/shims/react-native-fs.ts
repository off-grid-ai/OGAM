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

export * from '@dr.pogodin/react-native-fs';
export default RNFS;
