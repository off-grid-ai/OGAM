/**
 * Render a screen hook inside the real @react-navigation stack, so useNavigation / useFocusEffect /
 * navigate are the library's own. The hook runs in the first route's screen; every other route name
 * given mounts a plain screen that renders its name and params, so a test reads where the hook sent
 * the person by what is on top of the stack.
 *
 * Call after installNativeBoundary() (which resets the module graph). The test file must
 * `jest.unmock('@react-navigation/native')`.
 */
import { requireRTL } from './nativeBoundary';

export interface NavigatorHook<T> {
  result: { current: T };
  rtl: ReturnType<typeof requireRTL>;
  /** The route on top of the stack, with its params. */
  currentRoute(): { name: string; params?: Record<string, unknown> } | undefined;
  /** Go back to the hook's screen (re-focusing it). */
  goBack(): Promise<void>;
  unmount(): void;
}

export async function renderHookInNavigator<T>(
  hook: () => T,
  opts: { screen?: string; otherRoutes?: string[] } = {},
): Promise<NavigatorHook<T>> {
  const React = require('react');
  const rtl = requireRTL();
  const nav = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { Text } = require('react-native');
  const Stack = createNativeStackNavigator();
  const ref = nav.createNavigationContainerRef();
  const result = { current: undefined as unknown as T };

  function HookScreen() {
    result.current = hook();
    return null;
  }
  function RouteScreen({ route }: { route: { name: string; params?: unknown } }) {
    return React.createElement(Text, null, `${route.name} ${JSON.stringify(route.params ?? {})}`);
  }

  const screens = [
    React.createElement(Stack.Screen, { key: 'hook', name: opts.screen ?? 'Hook', component: HookScreen }),
    ...(opts.otherRoutes ?? []).map(name => React.createElement(Stack.Screen, { key: name, name, component: RouteScreen })),
  ];
  const view = rtl.render(
    React.createElement(nav.NavigationContainer, { ref }, React.createElement(Stack.Navigator, null, ...screens)),
  );
  await rtl.waitFor(() => expect(result.current).toBeDefined());

  return {
    result,
    rtl,
    currentRoute: () => ref.getCurrentRoute(),
    goBack: async () => { await rtl.act(async () => { ref.goBack(); }); },
    unmount: () => view.unmount(),
  };
}
