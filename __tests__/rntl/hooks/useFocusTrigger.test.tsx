/**
 * useFocusTrigger Hook Tests
 *
 * The trigger changes once, the first time a screen is seen, and never again: coming back to a
 * tab shows it at once, and a tab switch never re-renders the screen to read focus.
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
  it('a screen that opens in view is already seen', () => {
    const { seen } = mount();
    expect(seen[0]).toBe(1);
  });

  it('coming back to a screen does not replay it, or re-render it to read focus', async () => {
    const { navigation, seen } = mount();
    const renders = seen.length;
    await act(async () => navigation.navigate('Other'));
    await act(async () => navigation.goBack());
    expect(seen.at(-1)).toBe(1);
    expect(seen.length).toBe(renders);
  });
});
