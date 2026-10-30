/**
 * A device leaving the mesh takes its rules with it - both directions, together.
 *
 * Per-device rules outliving the device is the quiet failure: ids get reused, and a sharing or receive rule kept
 * past eviction silently applies to whatever device later claims that id. The user re-pairs a phone, everything
 * looks normal, and it is either receiving something they turned off or refusing something they never refused -
 * with nothing on any screen to explain it.
 *
 * Both real services run here (ambientShareService for what leaves, receivePreferences for what lands), with
 * persistence over the AsyncStorage boundary the repo already fakes. The failure path is driven by making that
 * boundary reject, which is how it actually fails on a device - a full disk, a revoked container - rather than
 * by standing in for one of our own services and asserting it was called.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SyncPreferences } from '../../../pro/sync/syncPreferences';
import { ambientShareService } from '../../../pro/sync/ambientShareService';
import { receivePreferences } from '../../../pro/sync/receivePreferences';
import { forgetDeviceRules } from '../../../pro/sync/forgetDeviceRules';

const THE_PHONE = 'the-phone';

/** What this phone is willing to sync at all - the categories the ambient policy is layered on top of. */
const PREFERENCES: SyncPreferences = {
  chats: true,
  projects: true,
  settings: true,
  notes: true,
  screenshots: true,
  downloads: false,
  generatedMedia: false,
  attachments: false,
};

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
  await receivePreferences.load();
  await ambientShareService.start(PREFERENCES, {
    destinations: () => [{ deviceId: THE_PHONE, deviceName: "Mac's iPhone", connected: true }],
    getFile: () => undefined,
    // Made on this device, so there is no origin to keep it away from.
    originOf: () => undefined,
    scheduleDelivery: () => {}
  } as never);
});

describe('a device leaving the mesh', () => {
  it('takes both its sharing rule and its receive rule with it', async () => {
    // The user had set this phone up specifically: send it screenshots, but do not accept its screenshots.
    await ambientShareService.setRule({
      source: 'screenshot',
      destinationId: THE_PHONE,
      mode: 'auto'
    } as never);
    await receivePreferences.setDeviceCategory(THE_PHONE, 'screenshot', false);
    expect(
      ambientShareService.snapshot().rules.some(rule => rule.destinationId === THE_PHONE)
    ).toBe(true);
    expect(receivePreferences.accepts(THE_PHONE, 'screenshot')).toBe(false);

    await forgetDeviceRules(THE_PHONE);

    // Neither rule survives. A kept rule would land on whichever device next takes this id, and a re-pair would
    // look broken for a reason the user cannot see anywhere.
    expect(
      ambientShareService.snapshot().rules.some(rule => rule.destinationId === THE_PHONE)
    ).toBe(false);
    expect(receivePreferences.accepts(THE_PHONE, 'screenshot')).toBe(true);
  });

  it('leaves every other device\'s rules alone', async () => {
    await receivePreferences.setDeviceCategory(THE_PHONE, 'clipboard', false);
    await receivePreferences.setDeviceCategory('the-ipad', 'screenshot', false);

    await forgetDeviceRules(THE_PHONE);

    // Forgetting one device must not reset the mesh. Someone who unpairs a lost phone would otherwise silently
    // start accepting everything from every other device they own.
    expect(receivePreferences.accepts('the-ipad', 'screenshot')).toBe(false);
  });

  it('completes the eviction even when the rule cannot be written away', async () => {
    await receivePreferences.setDeviceCategory(THE_PHONE, 'clipboard', false);
    jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValue(new Error('ENOSPC: no space left on device'));

    // Synchronous on purpose: eviction has ALREADY happened by the time this runs, so it fires both clears and
    // lets them settle rather than making the caller wait. Refusing to finish because a preference write failed
    // would leave the device half-removed - gone from the mesh, still carrying rules.
    expect(() => forgetDeviceRules(THE_PHONE)).not.toThrow();

    // Let the rejected writes settle: the failure has to be swallowed and logged, not surface as an unhandled
    // rejection that crashes the app moments after an unpair.
    await new Promise(resolve => setImmediate(resolve));
  });

  it('has nothing to do for a device that never had a rule, and says nothing about it', async () => {
    expect(() => forgetDeviceRules('never-paired')).not.toThrow();
    await new Promise(resolve => setImmediate(resolve));

    // Unpairing something that never had rules is ordinary, not an error worth surfacing.
    expect(receivePreferences.accepts('never-paired', 'files')).toBe(true);
  });
});
