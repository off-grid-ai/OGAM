/**
 * UI integration — CPU Threads and Batch Size can go back to Auto, and typing a thread count starts
 * from the automatic one.
 *
 * Real ModelSettingsScreen → Text Generation → Advanced, real CpuThreadsSlider / BatchSizeSlider, real
 * SliderSetting, real useTextGenerationAdvanced, real hardwareService + cpu topology reader, real store.
 * Faked only at the native line: react-native-fs serves the OnePlus CPH2707 sysfs topology (four
 * performance cores → Auto (4)), and the native slider is a View whose onSlidingComplete is the drag
 * release a finger produces.
 *
 * Product rules (the user's view):
 *  - On Auto there is no reset icon: nothing to put back.
 *  - Once you set a value by hand, a reset icon appears; pressing it shows "Auto (N)" again and the
 *    icon goes away.
 *  - Tapping the thread value to type a number starts the editor at the count that will run (4 here),
 *    not at the slider's minimum "1".
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import { useAppStore } from '../../../src/stores';
import { hardwareService } from '../../../src/services/hardware';
import { ModelSettingsScreen } from '../../../src/screens/ModelSettingsScreen';

/** The OnePlus CPH2707 (3 efficiency + 4 performance + 1 prime), read off the device. */
const CPH2707_CAPACITIES = [380, 380, 380, 873, 873, 873, 873, 1024];

function serveTopology(capacities: number[]): void {
  const cpuinfo = capacities.map((_unused, cpu) => `processor\t: ${cpu}\n`).join('\n');
  (RNFS.readFile as jest.Mock).mockImplementation((path: string) => {
    if (path === '/proc/cpuinfo') return Promise.resolve(cpuinfo);
    const match = /\/sys\/devices\/system\/cpu\/cpu(\d+)\/cpu_capacity$/.exec(path);
    if (match) return Promise.resolve(`${capacities[Number(match[1])]}\n`);
    return Promise.reject(new Error(`ENOENT: ${path}`));
  });
}

/** Open Model Settings → Text Generation → Advanced, as the user does. */
function openAdvanced() {
  const screen = render(
    <NavigationContainer>
      <ModelSettingsScreen />
    </NavigationContainer>,
  );
  fireEvent.press(screen.getByTestId('text-generation-accordion'));
  fireEvent.press(screen.getByTestId('text-advanced-toggle'));
  return screen;
}

const shown = (screen: ReturnType<typeof render>, id: string) =>
  String(screen.getByTestId(`${id}-value`).props.children);

describe('CPU Threads and Batch Size — back to Auto, and typing starts from Auto', () => {
  const realOS = Platform.OS;

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    (hardwareService as unknown as { performanceCores: number | null }).performanceCores = null;
    serveTopology(CPH2707_CAPACITIES);
  });
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: realOS, configurable: true });
  });

  it('threads: a hand-set count shows a reset icon that puts it back to Auto (4)', async () => {
    const screen = openAdvanced();

    // BEFORE: automatic, and nothing to reset.
    await waitFor(() => expect(shown(screen, 'cpu-threads-stepper')).toBe('Auto (4)'));
    expect(screen.queryByTestId('cpu-threads-stepper-reset')).toBeNull();
    expect(screen.queryByLabelText('Use automatic threads')).toBeNull();

    // GESTURE: drag the slider to 6 and let go.
    fireEvent(screen.getByTestId('cpu-threads-stepper-slider'), 'slidingComplete', 6);
    await waitFor(() => expect(shown(screen, 'cpu-threads-stepper')).toBe('6'));
    expect(screen.getByLabelText('Use automatic threads')).toBeTruthy();

    // GESTURE: press the reset icon.
    fireEvent.press(screen.getByTestId('cpu-threads-stepper-reset'));
    await waitFor(() => expect(shown(screen, 'cpu-threads-stepper')).toBe('Auto (4)'));
    expect(screen.queryByTestId('cpu-threads-stepper-reset')).toBeNull();
  });

  it('batch size: a hand-set batch shows a reset icon that puts it back to Auto', async () => {
    const screen = openAdvanced();

    await waitFor(() => expect(shown(screen, 'batch-size-stepper')).toMatch(/^Auto \(\d+\)$/));
    const autoBatch = shown(screen, 'batch-size-stepper');
    expect(screen.queryByTestId('batch-size-stepper-reset')).toBeNull();

    fireEvent(screen.getByTestId('batch-size-stepper-slider'), 'slidingComplete', 256);
    await waitFor(() => expect(shown(screen, 'batch-size-stepper')).toBe('256'));
    expect(screen.getByLabelText('Use automatic batch size')).toBeTruthy();

    fireEvent.press(screen.getByTestId('batch-size-stepper-reset'));
    await waitFor(() => expect(shown(screen, 'batch-size-stepper')).toBe(autoBatch));
    expect(screen.queryByTestId('batch-size-stepper-reset')).toBeNull();
    expect(screen.queryByLabelText('Use automatic batch size')).toBeNull();
  });

  it('threads: tapping the value to type starts the editor at the automatic count, not 1', async () => {
    const screen = openAdvanced();
    await waitFor(() => expect(shown(screen, 'cpu-threads-stepper')).toBe('Auto (4)'));
    expect(screen.queryByTestId('cpu-threads-stepper-input')).toBeNull();

    fireEvent.press(screen.getByTestId('cpu-threads-stepper-value-button'));

    const input = screen.getByTestId('cpu-threads-stepper-input');
    expect(input.props.value).toBe('4');
    // The reset icon stays out of the way while typing.
    expect(screen.queryByTestId('cpu-threads-stepper-reset')).toBeNull();

    // Typing a number and submitting makes it a hand-set count, and the reset icon appears.
    fireEvent.changeText(input, '3');
    fireEvent(input, 'submitEditing');
    await waitFor(() => expect(shown(screen, 'cpu-threads-stepper')).toBe('3'));
    expect(screen.getByTestId('cpu-threads-stepper-reset')).toBeTruthy();
  });

  afterAll(() => {
    useAppStore.getState().updateSettings({ nThreads: 0, nBatch: 0 });
  });
});
