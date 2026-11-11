import { useStudyStore } from '../../../src/study/engine';
import { useProjectStore } from '../../../src/stores/projectStore';

it("never persists a protected project's study outputs in plain storage", () => {
  useProjectStore.setState({ projects: [
    { id: 'locked', name: 'L', pinVerifier: 'pin:v1:x', protectedBlob: 'atlasitem:v1:eA' } as any,
    { id: 'open', name: 'O' } as any,
  ] });
  const partialize = (useStudyStore as any).persist.getOptions().partialize;
  const saved = { locked: [{ title: 'secret quiz' }], open: [{ title: 'public guide' }] };
  expect(partialize({ saved })).toEqual({ saved: { open: [{ title: 'public guide' }] } });
});
