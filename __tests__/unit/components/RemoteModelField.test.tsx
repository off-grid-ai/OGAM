import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../../../src/components/AnimatedPressable', () => {
  const { TouchableOpacity } = require('react-native');
  return {
    AnimatedPressable: ({ children, ...props }: any) => (
      <TouchableOpacity {...props}>{children}</TouchableOpacity>
    ),
  };
});

jest.mock('../../../src/components/AppSheet', () => ({
  AppSheet: ({ children }: any) => children,
}));

import { RemoteModelField } from '../../../src/components/RemoteServerEditor/RemoteModelField';

const baseProps = {
  label: 'Text model',
  value: 'remote-vision:desktop:unsloth%2FQwen3.5-2B-GGUF',
  displayValue: 'Qwen 3.5 2B',
  options: [{ id: 'unsloth/Qwen3.5-2B-GGUF', name: 'Qwen 3.5 2B' }],
  onChange: jest.fn(),
  placeholder: 'llama3.2',
  testID: 'server-text-model',
};

describe('RemoteModelField', () => {
  it('shows exactly three periods while discovery is loading', () => {
    const view = render(<RemoteModelField {...baseProps} loading />);

    expect(view.getByTestId('server-text-model-loading')).toHaveTextContent('...');
    expect(view.queryByText('Loading models...')).toBeNull();
  });

  it('renders the application-projected name instead of the transport identity', () => {
    const view = render(<RemoteModelField {...baseProps} />);

    expect(view.getAllByText('Qwen 3.5 2B')).not.toHaveLength(0);
    expect(view.queryByText(baseProps.value)).toBeNull();
  });
});
