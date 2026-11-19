// The translation preview opens the app as a person who finished onboarding and has one model, so the main
// screens (and, in this dev build, Pro) are there to translate. ?route=onboarding shows first run instead.
//
// It writes that person's saved state where the app reads it on a phone (AsyncStorage, which is
// localStorage on the web), before the app loads. The app then starts from it through its own hydrate.
// Imported before App in preview/index.js.
const APP_STORAGE = 'local-llm-app-storage';
const DOWNLOADED_MODELS = '@local_llm/downloaded_models';

const DEMO_MODEL = {
  id: 'demo/qwen3-1.7b',
  name: 'Qwen3 1.7B',
  author: 'Qwen',
  filePath: '/demo/qwen3-1.7b.gguf',
  fileName: 'qwen3-1.7b.gguf',
  fileSize: 1100000000,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-11-01T00:00:00.000Z',
  engine: 'llama',
};

function readSaved(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function seed(route) {
  const saved = readSaved(APP_STORAGE) || { state: {}, version: 0 };
  const onboarded = route !== 'onboarding';
  saved.state = {
    ...saved.state,
    hasCompletedOnboarding: onboarded,
    onboardingPicks: null,
    activeModelId: onboarded ? DEMO_MODEL.id : null,
  };
  localStorage.setItem(APP_STORAGE, JSON.stringify(saved));
  localStorage.setItem(DOWNLOADED_MODELS, JSON.stringify(onboarded ? [DEMO_MODEL] : []));
}

try {
  seed(new URLSearchParams(window.location.search).get('route'));
} catch {
  // No storage (a private window): the app shows first run, which is still a screen to translate.
}
