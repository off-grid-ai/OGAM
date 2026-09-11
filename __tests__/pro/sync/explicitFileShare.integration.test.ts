/**
 * Sharing a file the user picked, on purpose — with the real service doing the work.
 *
 * Three things a user experiences, and two of them are about silence:
 *
 *  - Cancelling the system picker says NOTHING. A red "Could not share this file" after someone deliberately
 *    backed out is the app blaming them for their own decision.
 *  - A real failure is NOT silent, or a file they believe is on its way never arrives and nothing ever says so.
 *  - A second tap while the picker is open does not start a second pick. The share button stays on screen the
 *    whole time it is open, and two picks racing to write one transfer is a corrupt transfer.
 *
 * WHAT RUNS FOR REAL: the hook, `projectExplicitFileShare` (which decides WHO the file goes to), the real
 * `resolvePickedFileUri`, and the real `sharedFileSyncService`, started through the app's own bootstrap.
 *
 * THE SUCCESSFUL share is deliberately NOT here. Running it for real needs a genuinely PAIRED peer, because the
 * service keeps its own truth and refuses with "Pair a device before sharing a file." when its state holds none -
 * telling the hook about a device is not the same as the mesh having one. That is worth knowing and was invisible
 * to the mocked version of this file, which was always ready. `ambientShare.integration` already pairs a real
 * peer over the loopback transport and asserts the bytes land, so duplicating it here would add a second, weaker
 * copy of a journey that is already covered properly.
 *
 * WHAT IS STOOD IN FOR, and only this: the two genuine device boundaries. The system document picker
 * (`@react-native-documents/picker`) and the native TCP module, through the shared harness the other sync
 * suites already use (`__tests__/utils/nativeSyncBoundaries`). The filesystem uses the repo's existing RNFS
 * boundary fake.
 *
 * An earlier version of this file stood in for `sharedFileSyncService` and `resolvePickedFileUri` - both ours -
 * on the grounds that the real service "cannot be imported in jest". It can: it fails only while the native TCP
 * module is absent, which is what the harness above is for, and which five neighbouring suites were already
 * doing. That version was deleted rather than repaired; this is what replaces it.
 */
import { renderHook, act } from '@testing-library/react-native';
import {Platform} from 'react-native';
import type {MobileApplicationFixture} from '../../harness/mobileApplicationFixture';

jest.mock('react-native-tcp-socket', () => {
  const {
    createNativeTcpBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const {
    createNativeDiscoveryBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

/** The system picker: a native sheet, and the one thing a test genuinely cannot present. */
const mockPicker = { pick: jest.fn() };
jest.mock('@react-native-documents/picker', () => ({
  pick: (...args: unknown[]) => mockPicker.pick(...args),
  isErrorWithCode: (value: unknown) =>
    typeof value === 'object' && value !== null && 'code' in value,
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
}));

import { proIsPresent, requirePro } from '../helpers/requirePro';

type HookModule =
  typeof import('@offgrid/pro/ui/SyncScreen/useExplicitFileShare');

let useExplicitFileShare: HookModule['useExplicitFileShare'];
let applicationFixture: MobileApplicationFixture | undefined;
const platform = Platform.OS;

const describePro = proIsPresent() ? describe : describe.skip;

beforeAll(async () => {
  Object.defineProperty(Platform, 'OS', {value: 'android', configurable: true});
  const hook = requirePro<HookModule>(
    '@offgrid/pro/ui/SyncScreen/useExplicitFileShare',
  );
  if (!hook) return;
  useExplicitFileShare = hook.useExplicitFileShare;
  const {startMobileApplicationFixture} = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  applicationFixture = await startMobileApplicationFixture({pro: true});
});

afterAll(async () => {
  await applicationFixture?.dispose();
  Object.defineProperty(Platform, 'OS', {value: platform, configurable: true});
});

const CONNECTED_MAC = {
  id: 'the-mac',
  name: 'The Mac',
  status: 'connected',
} as never;

/** What the picker hands back when the user chooses a file. */
const picked = (over: Record<string, unknown> = {}) => [
  {
    uri: 'content://downloads/report.pdf',
    name: 'report.pdf',
    type: 'application/pdf',
    ...over,
  },
];

const cancelled = () => {
  const error = new Error('cancelled') as Error & { code: string };
  error.code = 'OPERATION_CANCELED';
  return error;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describePro('sharing a file to a paired device', () => {
  it('says nothing at all when the user backs out of the picker', async () => {
    mockPicker.pick.mockRejectedValue(cancelled());
    const { result } = renderHook(() =>
      useExplicitFileShare({
        destinationId: 'the-mac',
        devices: [CONNECTED_MAC],
      }),
    );

    await act(async () => {
      await result.current.share();
    });

    // The whole point: backing out is a decision, not a fault. An error here reads as the app telling the user
    // off for something they chose.
    expect(result.current.error).toBeNull();
    expect(result.current.message).toBeNull();
    expect(result.current.sharing).toBe(false);
  });

  it('does say something when the share genuinely fails', async () => {
    mockPicker.pick.mockRejectedValue(new Error('the file could not be read'));
    const { result } = renderHook(() =>
      useExplicitFileShare({
        destinationId: 'the-mac',
        devices: [CONNECTED_MAC],
      }),
    );

    await act(async () => {
      await result.current.share();
    });

    // Silence on a real failure is the worse bug of the two: the user believes the file is on its way.
    expect(result.current.error).toBe('the file could not be read');
    expect(result.current.message).toBeNull();
  });

  it('refuses before it opens anything when there is nowhere to send it', async () => {
    const { result } = renderHook(() =>
      useExplicitFileShare({ destinationId: 'the-mac', devices: [] }),
    );

    await act(async () => {
      await result.current.share();
    });

    // Opening a file picker only to fail afterwards wastes the user's time and their choice. The projection
    // decides there is no destination, and nothing native is touched.
    expect(result.current.error).toBe('Pair a device before sharing a file.');
    expect(mockPicker.pick).not.toHaveBeenCalled();
  });

  it('will not start a second pick while the first is still open', async () => {
    let releasePicker: (value: unknown) => void = () => {};
    mockPicker.pick.mockImplementation(
      () =>
        new Promise(resolve => {
          releasePicker = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useExplicitFileShare({
        destinationId: 'the-mac',
        devices: [CONNECTED_MAC],
      }),
    );

    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.share();
      await Promise.resolve();
    });
    // The button is still on screen while the sheet is up, so this is a tap a user really can make.
    await act(async () => {
      await result.current.share();
    });

    expect(mockPicker.pick).toHaveBeenCalledTimes(1);

    await act(async () => {
      releasePicker(picked());
      await first;
    });
  });
});
