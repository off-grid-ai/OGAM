import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import {
  AliveProvider,
  aliveTouchDown,
  aliveTouchMove,
  aliveTouchUp,
  aliveTouchCancelled,
  useAlive,
  type AliveSignals,
} from '../../../src/components/AliveProvider';
import { ALIVE } from '../../../src/constants';

function renderSignals(): { signals: () => AliveSignals; ui: ReturnType<typeof render>; onPress: jest.Mock } {
  let signals: AliveSignals | null = null;
  const Probe = () => {
    signals = useAlive();
    return null;
  };
  const onPress = jest.fn();
  const ui = render(
    <AliveProvider>
      <Probe />
      <TouchableOpacity onPress={onPress}><Text>Recent chat</Text></TouchableOpacity>
    </AliveProvider>,
  );
  return { signals: () => signals!, ui, onPress };
}

describe('AliveProvider', () => {
  it('leaves every touch to the screen: it only listens', () => {
    const { ui, onPress } = renderSignals();
    fireEvent.press(ui.getByText('Recent chat'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a finger lights the field under it and sends a ring out from where it came down', () => {
    const { signals } = renderSignals();
    aliveTouchDown(signals(), 120, 340, false);
    expect([signals().touchX.value, signals().touchY.value]).toEqual([120, 340]);
    expect([signals().ringX.value, signals().ringY.value]).toEqual([120, 340]);

    aliveTouchMove(signals(), 150, 360);
    expect([signals().touchX.value, signals().touchY.value]).toEqual([150, 360]);
    // The ring set out from where the finger came down, not where it moved to.
    expect(signals().ringX.value).toBe(120);
  });

  it('with reduced motion a touch moves nothing: no light, no ring', () => {
    const { signals } = renderSignals();
    aliveTouchDown(signals(), 120, 340, true);
    expect(signals().ringX.value).toBe(-1000);
    expect(signals().ringRadius.value).toBe(ALIVE.ringReach);
  });

  it('the light fades when the finger lifts', () => {
    const { signals } = renderSignals();
    aliveTouchDown(signals(), 10, 10, false);
    aliveTouchUp(signals());
    // Reanimated's test build settles a timing at its target.
    expect(signals().touch.value).toBe(0);
  });

  it('a cancelled touch is not a lift: the light holds first, then fades', () => {
    const reanimated = require('react-native-reanimated');
    const { signals } = renderSignals();
    aliveTouchDown(signals(), 10, 10, false);
    reanimated.withDelay.mockClear?.();
    aliveTouchCancelled(signals());
    expect(reanimated.withDelay).toHaveBeenCalledWith(ALIVE.holdAfterCancelMs, expect.anything());
  });

  it('is absent outside the provider, so a field there only breathes', () => {
    let signals: AliveSignals | null | undefined;
    const Probe = () => {
      signals = useAlive();
      return null;
    };
    render(<Probe />);
    expect(signals).toBeNull();
  });
});
