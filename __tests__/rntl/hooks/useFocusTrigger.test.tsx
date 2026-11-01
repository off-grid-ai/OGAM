/**
 * useFocusTrigger Hook Tests
 *
 * Tests for the focus trigger hook:
 * - Returns 0 before the screen has been focused
 * - Increments when screen gains focus
 * - Does not increment when unfocused
 *
 * The real navigator runs: a stack with two screens. Focus moves the way it does in the app,
 * by navigating away and back.
 */
jest.unmock('@react-navigation/native');

import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useFocusTrigger } from '../../../src/hooks/useFocusTrigger';

type Routes = { Home: undefined; Other: undefined };
const Stack = createNativeStackNavigator<Routes>();

function mount() {
  const navigation = createNavigationContainerRef<Routes>();
  const seen: number[] = [];
  function Home() {
    const trigger = useFocusTrigger();
    seen.push(trigger);
    return <Text testID="home-trigger">{trigger}</Text>;
  }
  const view = render(
    <NavigationContainer ref={navigation}>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={Home} />
        <Stack.Screen name="Other" component={() => <Text>Other</Text>} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  return { view, navigation, seen };
}

describe('useFocusTrigger', () => {
  it('starts at 0 on the first render', () => {
    const { seen } = mount();
    expect(seen[0]).toBe(0);
  });

  it('increments each time the screen gains focus again', async () => {
    const { navigation, seen } = mount();
    const before = seen.at(-1)!;
    await act(async () => navigation.navigate('Other'));
    await act(async () => navigation.goBack());
    expect(seen.at(-1)).toBeGreaterThan(before);
  });

  it('does not increment while the screen is out of focus', async () => {
    const { navigation, seen } = mount();
    await act(async () => navigation.navigate('Other'));
    const away = seen.at(-1)!;
    await act(async () => navigation.setParams(undefined as never));
    expect(seen.at(-1)).toBe(away);
  });
});
