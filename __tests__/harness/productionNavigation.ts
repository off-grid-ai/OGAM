import type { NativeBoundary } from './nativeBoundary';

export interface ReturningUserModelOptions {
  readonly id?: string;
  readonly name?: string;
  readonly fileName?: string;
  readonly engine?: 'llama' | 'litert';
}

/**
 * Put only durable device facts in place for a returning user. The real model-library bootstrap
 * reads these facts and publishes them to the production navigator. No application store is written.
 */
export async function seedReturningUserWithTextModel(
  boundary: NativeBoundary,
  options: ReturningUserModelOptions = {},
) {
  if (!boundary.fs)
    throw new Error(
      'The production navigation fixture needs a filesystem boundary.',
    );
  const engine = options.engine ?? 'litert';
  const fileName =
    options.fileName ??
    (engine === 'litert'
      ? 'navigation-model.litertlm'
      : 'navigation-model.gguf');
  const modelPath = `${boundary.fs.DocumentDirectoryPath}/models/${fileName}`;
  boundary.fs.seedFile(modelPath, 500 * 1024 * 1024);

  const { createDownloadedModel } =
    require('../utils/factories') as typeof import('../utils/factories');
  const model = createDownloadedModel({
    id: options.id ?? 'navigation-model',
    name: options.name ?? 'Navigation Model',
    engine,
    filePath: modelPath,
    fileName,
    fileSize: 2 * 1024 * 1024 * 1024,
  });
  const AsyncStorage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  await AsyncStorage.setItem(
    '@local_llm/downloaded_models',
    JSON.stringify([model]),
  );
  await AsyncStorage.setItem(
    'local-llm-app-storage',
    JSON.stringify({
      state: {
        hasCompletedOnboarding: true,
        checklistDismissed: true,
        onboardingChecklist: {
          downloadedModel: true,
          loadedModel: true,
          sentMessage: true,
          triedImageGen: true,
          exploredSettings: true,
          createdProject: true,
        },
      },
      version: 0,
    }),
  );
  return model;
}

/** Mount the real application root, including bootstrap, providers, and production navigation. */
export function renderProductionApp(
  rtl: ReturnType<typeof import('./nativeBoundary').requireRTL>,
) {
  const React = require('react') as typeof import('react');
  const App = (require('../../App') as typeof import('../../App')).default;
  return rtl.render(React.createElement(App));
}
