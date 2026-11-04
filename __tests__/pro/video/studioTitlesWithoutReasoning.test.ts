/**
 * Story titles an older build cut from a prompt that carried a model's reasoning load without it.
 *
 * SPEC (community report, 2026-11-03): "<think> …" showed as a title in the bottom sheet and elsewhere.
 * Extend and Make it a story titled a film from the clip's prompt, which kept a thinking model's reply.
 * The real studio store loads what the phone saved, the way the app starts (AsyncStorage is the device).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

it('a saved story title loses the reasoning markup; a plain title is kept', async () => {
  const story = (id: string, title: string) => ({ id, title, shots: [], createdAt: 0, updatedAt: 0 });
  await AsyncStorage.setItem('video_studio_v1', JSON.stringify({
    state: {
      stories: {
        a: story('a', '<think>Calm night scene.</think>A lighthouse at night · 2'),
        b: story('b', 'Cinematic tracking shot of a car · 2'),
      },
    },
    version: 0,
  }));
  const { useStudioStore } = require('../../../pro/video/studio/studioStore');

  await useStudioStore.persist.rehydrate();

  const { stories } = useStudioStore.getState();
  expect(stories.a.title).toBe('A lighthouse at night · 2');
  expect(stories.b.title).toBe('Cinematic tracking shot of a car · 2');
});
