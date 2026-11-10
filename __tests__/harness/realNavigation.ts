/**
 * Real navigation for a screen a test renders on its own.
 *
 * The test file calls `jest.unmock('@react-navigation/native')`, and the screen is rendered as the one screen
 * of a real React Navigation stack, so useNavigation, useRoute, useFocusEffect and navigate are the library's
 * own. Nothing of ours is faked. `params` are the route's params, as a navigate to the screen hands them.
 */
import React from 'react';

export function withNavigator(element: React.ReactElement, params?: Record<string, unknown>): React.ReactElement {
  const { NavigationContainer } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const Stack = createNativeStackNavigator();
  return React.createElement(
    NavigationContainer,
    null,
    React.createElement(
      Stack.Navigator,
      { screenOptions: { headerShown: false } },
      React.createElement(Stack.Screen, { name: 'Host', initialParams: params, children: () => element }),
    ),
  );
}

/**
 * Like withNavigator, but the stack also holds the routes the screen can leave to, so a test can see
 * where a press really went.
 *
 * - `destinations`: route names the screen may navigate to. Each renders a line with the testID
 *   `route-<name>`, so arriving there is visible.
 * - `openedFrom`: the route the screen was opened from. The stack starts as [openedFrom, Host], so the
 *   screen's own Back really returns there (its `route-<openedFrom>` line shows again).
 * - `parentDestinations`: routes of a parent navigator around this stack (the app's root stack around
 *   its tabs), for a screen that acts on `navigation.getParent()`. Each renders `route-<name>` too.
 * - `screens`: real screens the screen pushes, by route name (the Gallery's image and video routes), so
 *   a test drives them as the app does.
 */
export function withNavigatorRoutes(
  element: React.ReactElement,
  options: {
    params?: Record<string, unknown>;
    destinations?: string[];
    openedFrom?: string;
    parentDestinations?: string[];
    screens?: Record<string, React.ComponentType<any>>;
  } = {},
): React.ReactElement {
  const { NavigationContainer } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { Text } = require('react-native');
  const Stack = createNativeStackNavigator();
  const routeLine = (name: string) => () => React.createElement(Text, { testID: `route-${name}` }, name);
  const others = [...(options.openedFrom ? [options.openedFrom] : []), ...(options.destinations ?? [])];
  const stackState = options.openedFrom
    ? { index: 1, routes: [{ name: options.openedFrom }, { name: 'Host', params: options.params }] }
    : undefined;
  const stack = () =>
    React.createElement(
      Stack.Navigator,
      { screenOptions: { headerShown: false } },
      React.createElement(Stack.Screen, { name: 'Host', initialParams: options.params, children: () => element }),
      ...others.map(name => React.createElement(Stack.Screen, { key: name, name, component: routeLine(name) })),
      ...Object.entries(options.screens ?? {}).map(([name, component]) =>
        React.createElement(Stack.Screen, { key: name, name, component })),
    );
  if (!options.parentDestinations?.length) {
    return React.createElement(NavigationContainer, { initialState: stackState }, stack());
  }
  const Parent = createNativeStackNavigator();
  const initialState = stackState ? { index: 0, routes: [{ name: 'App', state: stackState }] } : undefined;
  return React.createElement(
    NavigationContainer,
    { initialState },
    React.createElement(
      Parent.Navigator,
      { screenOptions: { headerShown: false } },
      React.createElement(Parent.Screen, { name: 'App', children: stack }),
      ...options.parentDestinations.map(name =>
        React.createElement(Parent.Screen, { key: name, name, component: routeLine(name) })),
    ),
  );
}
