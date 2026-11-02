/** The llama.cpp build the app gates catalog models on: a loaded engine pack's, else the bundled one. */
import { runningLlamaBuild, setLoadedPackBuild } from '../../../src/services/enginePacks/running';

afterEach(() => setLoadedPackBuild(null));

it('is unknown when the bundled engine reports no build', () => {
  expect(runningLlamaBuild()).toBeUndefined();
});

it('is the loaded pack build once a pack runs', () => {
  setLoadedPackBuild(12024);
  expect(runningLlamaBuild()).toBe(12024);
});
