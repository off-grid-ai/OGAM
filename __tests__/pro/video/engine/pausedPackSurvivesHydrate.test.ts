/**
 * A paused video pack download stays on the phone until the person cancels it.
 *
 * SPEC (OGAM user's view): Mac paused "Wan 2.1 (1.3B), FP16" at 0 B of 6.3 GB. After a relaunch and
 * after the app comes back to the front, Models › Video still shows it paused with Resume, and the
 * Downloads badge still counts it. Device 2026-11-06: the row vanished with no notice. The pack's
 * record (videoDownloads) was still saved, but the row every screen reads was dropped: the foreground
 * hydrate rebuilt the download store from native rows only, and a paused pack has none.
 *
 * The real video download provider, download store and hydrate run. Device boundaries only: the disk
 * and the background downloader (an iOS relaunch: no native row outlives the app).
 */
import { bootPhoneVideo, closePhoneVideo, until, WAN } from '../../../harness/phoneVideoServices';

afterEach(() => closePhoneVideo());

const KEY = `video:${WAN}`;

it('a paused pack keeps its row through a relaunch and a foreground hydrate', async () => {
  const first = await bootPhoneVideo();
  const { CATALOG } = require('@offgrid/models');
  const model = CATALOG.find((entry: { id: string }) => entry.id === WAN);
  first.provider.start!({ modelType: 'video', model }).catch(() => undefined);
  const firstStore = require('../../../../src/stores/downloadStore').useDownloadStore;
  await until(() => firstStore.getState().downloads[KEY]?.status === 'running', 10_000, 'the pack to start');
  await first.provider.pause!(KEY);
  expect(firstStore.getState().downloads[KEY].status).toBe('paused');

  // Relaunch: the saved pack record comes back and Pro's launch offers it as paused.
  await bootPhoneVideo({ relaunch: true });
  const { useDownloadStore } = require('../../../../src/stores/downloadStore');
  await until(() => useDownloadStore.getState().downloads[KEY]?.status === 'paused', 10_000, 'the paused row after relaunch');

  // The app comes back to the front: App.tsx onForeground rebuilds the store from native rows.
  const { hydrateDownloadStore } = require('../../../../src/services/downloadHydration');
  await hydrateDownloadStore();

  expect(useDownloadStore.getState().downloads[KEY]?.status).toBe('paused');
  // The Downloads badge and list count it (one rule for both).
  const { outstandingDownloadItems } = require('../../../../src/screens/DownloadManagerScreen/outstandingDownloads');
  const outstanding = outstandingDownloadItems({ downloads: useDownloadStore.getState().downloads, completed: [] });
  expect(outstanding.map((item: { modelId: string }) => item.modelId)).toContain(WAN);
  // Resume still reaches the provider.
  const { modelDownloadService } = require('../../../../src/services/modelDownloadService');
  const listed = await modelDownloadService.list();
  expect(listed.find((row: { id: string }) => row.id === KEY)?.capabilities.resume).toBe(true);
}, 60_000);
