/**
 * The card a user watches while a model moves between their devices.
 *
 * A model transfer is measured in gigabytes and minutes, so this card is the entire experience of it. Three
 * things have to be right, and each is wrong in a way the user feels:
 *
 *  - THE DIRECTION. "Sent" and "Received" are not interchangeable. On the phone that sent a 4 GB model,
 *    "Received Gemma" reads as though the transfer went backwards.
 *  - WHICH CONTROL IS OFFERED. Cancel belongs to a transfer still running; Dismiss belongs to one that has
 *    stopped. Offering Cancel on a finished transfer is a dead button, and offering only Dismiss on a running
 *    one leaves no way to stop four gigabytes crossing the network.
 *  - THE NUMBER. A percentage over 100, or a division by a zero total, is the difference between a progress bar
 *    and a visibly broken app.
 *
 * The real component, rendered. Nothing is stood in for: it is presentational, and its decisions are exactly
 * what a user reads.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

// The sheet's module graph reaches the sync services, which construct a NativeEventEmitter over the native TCP
// and mDNS modules at import time. Those are the genuine device boundaries; the component under test is pure.
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

import { proIsPresent, requirePro } from '../helpers/requirePro';

const describePro = proIsPresent() ? describe : describe.skip;

type SheetModule = typeof import('@offgrid/pro/ui/ModelTransferSheet');
let ModelTransferStatus: SheetModule['ModelTransferStatus'];
let formatModelTransferDetail: SheetModule['formatModelTransferDetail'];

beforeAll(() => {
  const mod = requirePro<SheetModule>('@offgrid/pro/ui/ModelTransferSheet');
  if (mod) {
    ModelTransferStatus = mod.ModelTransferStatus;
    formatModelTransferDetail = mod.formatModelTransferDetail;
  }
});

/** A transfer in whatever state the case needs. Bytes default to a half-finished 4 GB model. */
const transfer = (over: Record<string, unknown> = {}) =>
  ({
    requestId: 'req-1',
    fileName: 'gemma.gguf',
    direction: 'send',
    status: 'transferring',
    bytesTransferred: 2_000_000_000,
    totalBytes: 4_000_000_000,
    ...over,
  } as never);

describePro('the model transfer card', () => {
  it('shows megabytes moved, total megabytes, and the transfer rate', () => {
    expect(
      formatModelTransferDetail({
        phase: 'transferring',
        bytesTransferred: 1_500_000_000,
        bytesTotal: 5_500_000_000,
        startedAt: 1_000,
        updatedAt: 31_000,
        transferStartedAt: 1_000,
        transferStartedBytes: 0,
      } as never),
    ).toBe('1,500 MB / 5,500 MB · 50.0 MB/s');
  });

  it('does not count resumed bytes as bytes moved during this transfer interval', () => {
    expect(
      formatModelTransferDetail({
        phase: 'transferring',
        bytesTransferred: 2_500_000_000,
        bytesTotal: 5_500_000_000,
        startedAt: 1_000,
        updatedAt: 11_000,
        transferStartedAt: 1_000,
        transferStartedBytes: 2_000_000_000,
      } as never),
    ).toBe('2,500 MB / 5,500 MB · 50.0 MB/s');
  });

  it('shows an unknown rate until payload bytes move', () => {
    expect(
      formatModelTransferDetail({
        phase: 'queued',
        bytesTransferred: 0,
        bytesTotal: 5_500_000_000,
        startedAt: 1_000,
        updatedAt: 1_000,
      } as never),
    ).toBe('0 MB / 5,500 MB · — MB/s');
  });

  it.each([
    ['send', 'completed', 'Sent gemma.gguf'],
    ['receive', 'completed', 'Received gemma.gguf'],
    ['send', 'failed', 'Could not send gemma.gguf'],
    ['receive', 'failed', 'Could not receive gemma.gguf'],
    ['send', 'transferring', 'Sending gemma.gguf'],
    ['receive', 'transferring', 'Receiving gemma.gguf'],
  ])(
    'says the right thing for a %s that is %s',
    (direction, status, expected) => {
      const ui = render(
        <ModelTransferStatus progress={transfer({ direction, status })} />,
      );

      // Six combinations, one string each. Getting the direction wrong tells the user their transfer went the
      // other way, which is not a wording nit on a device they are holding while it happens.
      expect(ui.queryByText(expected)).not.toBeNull();
    },
  );

  it('names the other device, and which way the file is going', () => {
    const sending = render(
      <ModelTransferStatus
        progress={transfer({ direction: 'send' })}
        peerName="Mac's MacBook Pro"
      />,
    );
    expect(sending.queryByText("To Mac's MacBook Pro")).not.toBeNull();

    const receiving = render(
      <ModelTransferStatus
        progress={transfer({ direction: 'receive' })}
        peerName="Mac's iPhone"
      />,
    );
    expect(receiving.queryByText("From Mac's iPhone")).not.toBeNull();
  });

  it('shows no peer line when there is no peer name to show', () => {
    const ui = render(<ModelTransferStatus progress={transfer()} />);

    // Rather than "To undefined", which is what a missing name renders as if the line is unconditional.
    expect(ui.queryByText(/^To /)).toBeNull();
    expect(ui.queryByText(/^From /)).toBeNull();
  });

  it('reports the percentage transferred', () => {
    const ui = render(
      <ModelTransferStatus
        progress={transfer({
          bytesTransferred: 1_000_000_000,
          totalBytes: 4_000_000_000,
        })}
      />,
    );

    expect(ui.queryByText('25%')).not.toBeNull();
  });

  it('shows indeterminate progress rather than dividing by a total nobody has sent yet', () => {
    // A queued transfer has no total until the offer is answered. NaN% is what an unguarded division renders.
    const ui = render(
      <ModelTransferStatus
        progress={transfer({
          status: 'queued',
          bytesTransferred: 0,
          totalBytes: 0,
        })}
      />,
    );

    expect(ui.queryByText('In progress')).not.toBeNull();
    expect(ui.queryByText(/Rate unavailable/)).toBeNull();
    expect(ui.queryByText('NaN%')).toBeNull();
  });

  it('never claims more than 100%', () => {
    // The receiver counts bytes as they land and the sender pads the last chunk, so transferred can exceed the
    // declared total by a few bytes at the very end.
    const ui = render(
      <ModelTransferStatus
        progress={transfer({
          bytesTransferred: 4_200_000_000,
          totalBytes: 4_000_000_000,
        })}
      />,
    );

    expect(ui.queryByText('100%')).not.toBeNull();
    expect(ui.queryByText('105%')).toBeNull();
  });

  it.each(['queued', 'offering', 'transferring', 'verifying'])(
    'offers Cancel while the transfer is %s',
    status => {
      const ui = render(
        <ModelTransferStatus
          progress={transfer({ status })}
          onCancel={() => {}}
          onDismiss={() => {}}
        />,
      );

      // Still moving: the user must be able to stop gigabytes crossing their network.
      expect(ui.queryByTestId('cancel-model-transfer')).not.toBeNull();
      expect(ui.queryByTestId('dismiss-model-transfer')).toBeNull();
    },
  );

  it.each(['completed', 'failed'])(
    'offers Dismiss once the transfer is %s',
    status => {
      const ui = render(
        <ModelTransferStatus
          progress={transfer({ status })}
          onCancel={() => {}}
          onDismiss={() => {}}
        />,
      );

      // Stopped: Cancel would be a dead button, and the row needs a way off the screen.
      expect(ui.queryByTestId('dismiss-model-transfer')).not.toBeNull();
      expect(ui.queryByTestId('cancel-model-transfer')).toBeNull();
    },
  );

  it('offers no control at all when the caller handed it no handler', () => {
    const ui = render(<ModelTransferStatus progress={transfer()} />);

    // A button that cannot do anything is worse than no button.
    expect(ui.queryByTestId('cancel-model-transfer')).toBeNull();
    expect(ui.queryByTestId('dismiss-model-transfer')).toBeNull();
  });

  it('surfaces the reason a transfer failed', () => {
    const ui = render(
      <ModelTransferStatus
        progress={transfer({
          status: 'failed',
          error: 'the other device ran out of space',
        })}
        onDismiss={() => {}}
      />,
    );

    // "Could not send" alone leaves the user retrying into the same wall.
    expect(ui.queryByText('the other device ran out of space')).not.toBeNull();
  });
});
