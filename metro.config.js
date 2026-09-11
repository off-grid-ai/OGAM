const path = require('node:path');
const fs = require('node:fs');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const proPackagePath = path.resolve(__dirname, 'pro');
const proStubPath = path.resolve(__dirname, 'src/bootstrap/proStub.js');
// pro/ is a git submodule: the directory exists even when not checked out, so test
// for a real file inside it (package.json) to detect a populated submodule.
const proExists = fs.existsSync(path.resolve(proPackagePath, 'package.json'));

// @offgrid/sync lives OUTSIDE the project root (shared monorepo). Metro must watch its dist and
// resolve the package + its subpath adapters. We map the subpaths to concrete built files rather
// than enabling `unstable_enablePackageExports` globally (that flag changes resolution for every
// dep and breaks libraries with malformed exports maps). The package ships prebuilt CJS in dist/.
const syncPackagePath = path.resolve(__dirname, '../shared/packages/sync');
const applicationPackagePath = path.resolve(__dirname, '../shared/packages/application');
const automationPackagePath = path.resolve(__dirname, '../shared/packages/automation');
const ragPackagePath = path.resolve(__dirname, '../shared/packages/rag');
// @offgrid/models: cross-platform model contracts (catalog, reasoning-budget rule) shared
// with desktop. Out-of-root like rag, prebuilt CJS in dist/.
const modelsPackagePath = path.resolve(__dirname, '../shared/packages/models');
const uiPackagePath = path.resolve(__dirname, '../shared/packages/ui');
const usePackagePath = path.resolve(__dirname, '../shared/packages/use');
// @offgrid/speech: voice-turn decisions (when a spoken turn begins and ends) shared with desktop.
// Out-of-root like sync, so Metro must watch it and be pointed at its built entry.
const speechPackagePath = path.resolve(__dirname, '../shared/packages/speech');
const sharedNodeModulesPath = path.resolve(__dirname, '../shared/node_modules');
const syncRuntimeModules = {
  '@noble/hashes/hkdf': path.resolve(sharedNodeModulesPath, '@noble/hashes/hkdf.js'),
  '@noble/hashes/hmac': path.resolve(sharedNodeModulesPath, '@noble/hashes/hmac.js'),
  '@noble/hashes/sha256': path.resolve(sharedNodeModulesPath, '@noble/hashes/sha256.js'),
};
const modelsSemanticModules = {
  '@offgrid/models/catalog': path.resolve(modelsPackagePath, 'dist/catalog/index.js'),
  '@offgrid/models/quant': path.resolve(modelsPackagePath, 'dist/quant.js'),
};

const config = {
  // pro/ is a submodule inside the project root, so Metro already watches it by default. The sync
  // package is out-of-root, so Metro must be told to watch it (for its dist) — nothing else needed.
  watchFolders: [
    syncPackagePath,
    applicationPackagePath,
    automationPackagePath,
    ragPackagePath,
    modelsPackagePath,
    speechPackagePath,
    uiPackagePath,
    usePackagePath,
    sharedNodeModulesPath,
  ],
  resolver: {
    // When resolving modules from outside the project root (i.e. @offgrid/pro),
    // Metro falls back here so @babel/runtime and all other peer deps are found.
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules'), sharedNodeModulesPath],
    resolveRequest: (context, moduleName, platform) => {
      const syncRuntimeModule = syncRuntimeModules[moduleName];
      if (syncRuntimeModule) {
        return { type: 'sourceFile', filePath: syncRuntimeModule };
      }
      const modelsSemanticModule = modelsSemanticModules[moduleName];
      if (modelsSemanticModule) {
        return { type: 'sourceFile', filePath: modelsSemanticModule };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
    extraNodeModules: {
      // Exposes src/ as @offgrid/core so @offgrid/pro can import the design system,
      // stores, and registries without a circular package dependency.
      '@offgrid/core': path.resolve(__dirname, 'src'),
      // The app facade is a direct Mobile dependency. Metro does not reliably follow its
      // out-of-root workspace symlink during release bundling, so resolve its built entry exactly.
      '@offgrid/application': path.resolve(applicationPackagePath, 'dist/index.js'),
      // Shared, pure-TS RAG decisions. Point Metro at the built CommonJS entry directly:
      // resolving the external package directory can fail in an already-running dev server
      // after the file dependency is added, even though Node can resolve the package.
      '@offgrid/rag': path.resolve(ragPackagePath, 'dist/index.js'),
      '@offgrid/models': path.resolve(modelsPackagePath, 'dist/index.js'),
      '@offgrid/speech': path.resolve(speechPackagePath, 'dist/index.cjs'),
      '@offgrid/ui': path.resolve(uiPackagePath, 'dist/index.js'),
      '@offgrid/use': path.resolve(usePackagePath, 'dist/index.js'),
      // @offgrid/sync owns this dependency in its package manifest. Metro still needs the
      // out-of-root file dependency mapped to a watched, built CommonJS entry.
      '@offgrid/automation': path.resolve(automationPackagePath, 'dist/index.js'),
      // Points to the real pro package when present on disk (store builds),
      // falls back to a null stub so free builds bundle cleanly.
      '@offgrid/pro': proExists ? proPackagePath : proStubPath,
      // Single source of truth for react-native-fs. The app imports
      // 'react-native-fs', but executorch's bare-resource-fetcher pulls the
      // maintained fork '@dr.pogodin/react-native-fs'. Shipping both produces
      // duplicate RNFS Objective-C symbols at link time on iOS, so we alias the
      // old name onto the fork and keep a single native module.
      'react-native-fs': path.resolve(__dirname, 'src/shims/react-native-fs.ts'),
      // @offgrid/sync (out-of-root, prebuilt CJS). Main + subpath adapters mapped explicitly so we
      // don't have to enable global package-exports. Keep in step with the package's exports map.
      '@offgrid/sync': syncPackagePath,
      '@offgrid/sync/rn': path.resolve(syncPackagePath, 'dist/adapters/rn-tcp.js'),
      '@offgrid/sync/rn-discovery': path.resolve(syncPackagePath, 'dist/adapters/rn-discovery.js'),
      '@offgrid/sync/portable': path.resolve(syncPackagePath, 'dist/portable/index.js'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
