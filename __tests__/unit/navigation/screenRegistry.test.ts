import {
  registerScreen,
  getRegisteredScreens,
  _clearScreensForTesting,
} from '../../../src/navigation/screenRegistry';

const FakeScreen = () => null;
const AnotherScreen = () => null;

describe('screen registry', () => {
  beforeEach(() => {
    _clearScreensForTesting();
  });

  it('returns empty array when nothing registered', () => {
    expect(getRegisteredScreens()).toEqual([]);
  });

  it('registers a screen', () => {
    registerScreen({ name: 'McpServers', component: FakeScreen });
    expect(getRegisteredScreens()).toHaveLength(1);
    expect(getRegisteredScreens()[0].name).toBe('McpServers');
    expect(getRegisteredScreens()[0].component).toBe(FakeScreen);
  });

  it('registers multiple screens', () => {
    registerScreen({ name: 'McpServers', component: FakeScreen });
    registerScreen({ name: 'DebugLogs', component: AnotherScreen });
    expect(getRegisteredScreens()).toHaveLength(2);
    expect(getRegisteredScreens().map(s => s.name)).toEqual(['McpServers', 'DebugLogs']);
  });

  it('dedupes by name — a repeated registration is ignored (first wins)', () => {
    registerScreen({ name: 'McpServers', component: FakeScreen });
    registerScreen({ name: 'McpServers', component: AnotherScreen });
    expect(getRegisteredScreens()).toHaveLength(1);
    expect(getRegisteredScreens()[0].component).toBe(FakeScreen);
  });
});
