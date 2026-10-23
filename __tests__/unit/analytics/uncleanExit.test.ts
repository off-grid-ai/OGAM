/**
 * The unclean-exit marker never reports this launch's own work as the previous launch's death.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { markStageEnded, markStageStarted, takeUncleanExit } from '../../../src/services/analytics/uncleanExit';

it("a load already running in this launch is not the last launch's death, and its marker stays", async () => {
  markStageStarted({ stage: 'load', model: 'custom', engine: 'llama.cpp', backend: 'cpu', startedAt: Date.now(), appVersion: '1.0.0' });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(await takeUncleanExit('1.0.0')).toBeNull();
  expect(JSON.parse((await AsyncStorage.getItem('offgrid.analytics.uncleanExit'))!).stage).toBe('load');
  markStageEnded('load');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(await AsyncStorage.getItem('offgrid.analytics.uncleanExit')).toBeNull();
});

it('a marker from an earlier version is cleared and not reported', async () => {
  await AsyncStorage.setItem(
    'offgrid.analytics.uncleanExit',
    JSON.stringify({ stage: 'generate', model: 'custom', engine: 'llama.cpp', backend: 'cpu', startedAt: 1, appVersion: '0.9.0', foreground: true, launch: 'earlier' }),
  );
  // An update happened in between: a different version's death is not reported.
  expect(await takeUncleanExit('1.0.0')).toBeNull();
  expect(await AsyncStorage.getItem('offgrid.analytics.uncleanExit')).toBeNull();
});

it("a read that races this launch's own marker write never deletes the new marker", async () => {
  const earlier = JSON.stringify({ stage: 'load', model: 'custom', engine: 'llama.cpp', backend: 'cpu', startedAt: 1, appVersion: '1.0.0', foreground: true, launch: 'earlier' });
  markStageStarted({ stage: 'generate', model: 'custom', engine: 'llama.cpp', backend: 'cpu', startedAt: Date.now(), appVersion: '1.0.0' });
  // The disk read lands before this launch's write: it still holds the earlier launch's marker.
  (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(earlier);
  expect(await takeUncleanExit('1.0.0')).toMatchObject({ stage: 'load', launch: 'earlier' });
  expect(JSON.parse((await AsyncStorage.getItem('offgrid.analytics.uncleanExit'))!).stage).toBe('generate');
  markStageEnded('generate');
});
