import React from 'react';
import { render } from '@testing-library/react-native';
import { proIsPresent, requirePro } from '../helpers/requirePro';

const describePro = proIsPresent() ? describe : describe.skip;

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: { name: string }) => <Text>{name}</Text>;
});

type SectionModule =
  typeof import('@offgrid/pro/ui/SyncScreen/TransferActivitySection');

let TransferActivitySection: SectionModule['TransferActivitySection'];

beforeAll(() => {
  const module = requirePro<SectionModule>(
    '@offgrid/pro/ui/SyncScreen/TransferActivitySection',
  );
  if (module) TransferActivitySection = module.TransferActivitySection;
});

describePro('the Sync activity card', () => {
  it('shows the canonical transfer time', () => {
    const updatedAt = Date.UTC(2026, 8, 9, 4, 7);
    const projection = {
      items: [
        {
          id: 'completed-transfer',
          source: 'history',
          deviceId: 'desktop',
          direction: 'send',
          name: 'Qwen.gguf',
          status: 'completed',
          updatedAt,
          peerName: 'Studio Mac',
          phase: 'completed',
          percentage: 100,
          showProgress: false,
          file: {
            available: false,
            state: 'unavailable',
            preview: { kind: 'none' },
            open: { visible: false, enabled: false },
          },
          actions: {
            retry: { visible: false, enabled: false, sources: [] },
            cancel: { visible: false, enabled: false, sources: [] },
            dismiss: { visible: false, enabled: false, sources: [] },
          },
          capabilities: { retry: false, cancel: false, dismiss: false },
        },
      ],
      view: 'list',
      modelBytesPerSecondByActivityId: new Map(),
      recordsBySyncId: new Map(),
      dispatchAction: async () => undefined,
    } as never;

    const view = render(
      <TransferActivitySection projection={projection} onOpen={() => {}} />,
    );

    expect(view.getByText('To Studio Mac')).toBeTruthy();
    expect(
      view.getByText(new Date(updatedAt).toLocaleString()),
    ).toBeTruthy();
  });
});
