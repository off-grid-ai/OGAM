/**
 * ImageGenAdviceCard — in-chat GPU-path speed/quality guidance. Renders nothing off the
 * mnn path or at good settings; shows the right tips (raise steps / lower size / raise
 * size) when the live settings warrant it; is dismissible. Drives the REAL store + rule.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/Feather', () => 'Icon');
jest.mock('../../../src/components/AnimatedPressable', () => {
  const { TouchableOpacity } = require('react-native');
  return { AnimatedPressable: ({ children, onPress, testID }: any) => (
    <TouchableOpacity testID={testID} onPress={onPress}>{children}</TouchableOpacity>
  ) };
});

import { ImageGenAdviceCard } from '../../../src/components/ImageGenAdviceCard';
import { useAppStore } from '../../../src/stores';

const setup = (backend: string | undefined, imageSteps: number | undefined, imageWidth: number | undefined) => {
  useAppStore.setState({
    downloadedImageModels: backend
      ? ([{ id: 'img', name: 'M', modelPath: '/m', backend, downloadedAt: '', size: 1 }] as any)
      : ([] as any),
    activeImageModelId: backend ? 'img' : null,
    settings: { ...useAppStore.getState().settings, imageSteps, imageWidth, imageHeight: imageWidth } as any,
  });
};

describe('ImageGenAdviceCard', () => {
  it('renders nothing on the NPU (qnn) path', () => {
    setup('qnn', 8, 512);
    expect(render(<ImageGenAdviceCard />).queryByTestId('image-gen-advice')).toBeNull();
  });

  it('renders nothing at the sweet spot (mnn, 22 steps, 256)', () => {
    setup('mnn', 22, 256);
    expect(render(<ImageGenAdviceCard />).queryByTestId('image-gen-advice')).toBeNull();
  });

  it('shows the raise-steps tip on the GPU path at low steps', () => {
    setup('mnn', 8, 256);
    const { getByTestId, queryByTestId } = render(<ImageGenAdviceCard />);
    expect(getByTestId('image-gen-advice')).toBeTruthy();
    expect(getByTestId('image-gen-advice-steps')).toBeTruthy();
    expect(queryByTestId('image-gen-advice-size')).toBeNull();
  });

  it('shows the lower-size tip when too large (512)', () => {
    setup('mnn', 22, 512);
    expect(render(<ImageGenAdviceCard />).getByTestId('image-gen-advice-size')).toBeTruthy();
  });

  it('shows the raise-size (garbage) tip when below 256 (the 128 case)', () => {
    setup('mnn', 22, 128);
    const { getByTestId, queryByTestId } = render(<ImageGenAdviceCard />);
    expect(getByTestId('image-gen-advice-raise-size')).toBeTruthy();
    expect(queryByTestId('image-gen-advice-size')).toBeNull();
  });

  it('can be dismissed (session) — hides after tapping X', () => {
    setup('mnn', 8, 256);
    const { getByTestId, queryByTestId } = render(<ImageGenAdviceCard />);
    fireEvent.press(getByTestId('image-gen-advice-dismiss'));
    expect(queryByTestId('image-gen-advice')).toBeNull();
  });

  it('treats undefined steps/size as 0 without crashing (nullish fallback branch)', () => {
    setup('mnn', undefined, undefined);
    // width 0 => not >256 and not (0<256 && >0) => no size tip; steps 0 (<20) => raiseSteps.
    const { getByTestId, queryByTestId } = render(<ImageGenAdviceCard />);
    expect(getByTestId('image-gen-advice-steps')).toBeTruthy();
    expect(queryByTestId('image-gen-advice-raise-size')).toBeNull();
  });
});
