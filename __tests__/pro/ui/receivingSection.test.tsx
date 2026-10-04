import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { proIsPresent, requirePro } from '../helpers/requirePro';

const describePro = proIsPresent() ? describe : describe.skip;

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: { name: string }) => <Text>{name}</Text>;
});

type SectionModule =
  typeof import('@offgrid/pro/ui/SyncScreen/ReceivingSection');

let ReceivingSection: SectionModule['ReceivingSection'];
let RECEIVE_ANY_SOURCE: SectionModule['RECEIVE_ANY_SOURCE'];

beforeAll(() => {
  const module = requirePro<SectionModule>(
    '@offgrid/pro/ui/SyncScreen/ReceivingSection',
  );
  if (!module) return;
  ReceivingSection = module.ReceivingSection;
  RECEIVE_ANY_SOURCE = module.RECEIVE_ANY_SOURCE;
});

const handlers = () => ({
  onOptionalEnabledChange: jest.fn(),
  onCategoryChange: jest.fn(),
  onDeviceOptionalEnabledChange: jest.fn(),
  onDeviceCategoryChange: jest.fn(),
});

const policyWith = (overrides: Record<string, unknown> = {}): never => {
  const { DEFAULT_RECEIVE_POLICY } = require('@offgrid/sync');
  return { ...DEFAULT_RECEIVE_POLICY, ...overrides } as never;
};

const categoryIds = (policy: never, deviceId?: string): string[] => {
  const { projectSyncReceiving } = require('@offgrid/sync');
  return projectSyncReceiving(policy, deviceId).categories.map(
    (category: { id: string }) => category.id,
  );
};

const chooseSource = (
  view: ReturnType<typeof render>,
  deviceId: string,
): void => {
  fireEvent.press(view.getByTestId('receive-source-select'));
  fireEvent.press(view.getByTestId(`receive-source-select-option-${deviceId}`));
};

describePro('the Receiving section', () => {
  it('shows no source selector until a device is paired', () => {
    const view = render(
      <ReceivingSection policy={policyWith()} devices={[]} {...handlers()} />,
    );

    expect(view.queryByTestId('receive-source-select')).toBeNull();
    expect(view.getByTestId('receive-master-toggle')).toBeTruthy();
  });

  it('states what happens to refused optional data', () => {
    const view = render(
      <ReceivingSection policy={policyWith()} devices={[]} {...handlers()} />,
    );

    expect(
      view.getByText(
        /never written to this device or passed to your other devices/i,
      ),
    ).toBeTruthy();
  });

  it('does not offer controls for required generated media or attachments', () => {
    const view = render(
      <ReceivingSection policy={policyWith()} devices={[]} {...handlers()} />,
    );

    fireEvent.press(view.getByTestId('receive-open-rules'));
    expect(view.queryByText('Generated media')).toBeNull();
    expect(view.queryByText('Message attachments')).toBeNull();
  });

  it('routes the optional master to the selected scope', () => {
    const callbacks = handlers();
    const view = render(
      <ReceivingSection
        policy={policyWith()}
        devices={[{ id: 'laptop', name: 'The Mac' }]}
        {...callbacks}
      />,
    );

    fireEvent(view.getByTestId('receive-master-toggle'), 'valueChange', false);
    expect(callbacks.onOptionalEnabledChange).toHaveBeenCalledWith(false);

    chooseSource(view, 'laptop');
    fireEvent(view.getByTestId('receive-master-toggle'), 'valueChange', false);
    expect(callbacks.onDeviceOptionalEnabledChange).toHaveBeenCalledWith(
      'laptop',
      false,
    );
  });

  it('names the selected device and explains precedence', () => {
    const view = render(
      <ReceivingSection
        policy={policyWith()}
        devices={[{ id: 'laptop', name: 'The Mac' }]}
        {...handlers()}
      />,
    );

    chooseSource(view, 'laptop');
    expect(view.getByText(/Editing rules for The Mac/)).toBeTruthy();
    expect(view.getByText(/overrides All devices/)).toBeTruthy();
  });

  it('uses a device id when the device has no name', () => {
    const view = render(
      <ReceivingSection
        policy={policyWith()}
        devices={[{ id: 'unnamed-device-id' }]}
        {...handlers()}
      />,
    );

    chooseSource(view, 'unnamed-device-id');
    expect(view.getByText('unnamed-device-id')).toBeTruthy();
  });

  it('routes matrix decisions to global and device category handlers', () => {
    const categoryId = categoryIds(policyWith())[0];
    expect(categoryId).toBeTruthy();

    const globalCallbacks = handlers();
    const globalView = render(
      <ReceivingSection
        policy={policyWith()}
        devices={[{ id: 'laptop', name: 'The Mac' }]}
        {...globalCallbacks}
      />,
    );
    fireEvent.press(globalView.getByTestId('receive-open-rules'));
    fireEvent.press(globalView.getByTestId(`receive-${categoryId}-refuse`));
    expect(globalCallbacks.onCategoryChange).toHaveBeenCalledWith(
      categoryId,
      false,
    );

    const deviceCallbacks = handlers();
    const deviceView = render(
      <ReceivingSection
        policy={policyWith()}
        devices={[{ id: 'laptop', name: 'The Mac' }]}
        {...deviceCallbacks}
      />,
    );
    chooseSource(deviceView, 'laptop');
    fireEvent.press(deviceView.getByTestId('receive-open-rules'));
    fireEvent.press(deviceView.getByTestId(`receive-${categoryId}-refuse`));
    expect(deviceCallbacks.onDeviceCategoryChange).toHaveBeenCalledWith(
      'laptop',
      categoryId,
      false,
    );
  });

  it('disables matrix decisions while optional receiving is off', () => {
    const policy = policyWith({ optionalEnabled: false });
    const view = render(
      <ReceivingSection policy={policy} devices={[]} {...handlers()} />,
    );
    fireEvent.press(view.getByTestId('receive-open-rules'));

    for (const categoryId of categoryIds(policy)) {
      expect(
        view.getByTestId(`receive-${categoryId}-accept`).props
          .accessibilityState.disabled,
      ).toBe(true);
      expect(
        view.getByTestId(`receive-${categoryId}-refuse`).props
          .accessibilityState.disabled,
      ).toBe(true);
    }
  });

  it('exports the all-device scope sentinel', () => {
    expect(RECEIVE_ANY_SOURCE).toBe('any');
  });
});
