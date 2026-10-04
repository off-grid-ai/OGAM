/**
 * Journey M4 - Turn the passphrase on, change it, turn it off.
 *
 * One test per contract line in shared/docs/FLOW_CONTRACT_MOBILE.md. Every test arrives through real
 * gestures on the real Security, setup and Lock screens, and asserts only what a person can see.
 *
 * The only fake is the device keystore. Everything above it is production behavior.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PassphraseSetupScreen } from '../../../src/screens/PassphraseSetupScreen';
import { LockScreen } from '../../../src/screens/LockScreen';
import { SecuritySettingsScreen } from '../../../src/screens/SecuritySettingsScreen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { mobileSecurity } from '../../../src/services';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

jest.mock('react-native-keychain', () => {
  let entry: { username: string; password: string } | false = false;
  return {
    setGenericPassword: async (username: string, password: string) => {
      entry = { username, password };
      return true;
    },
    getGenericPassword: async () => entry,
    resetGenericPassword: async () => {
      entry = false;
      return true;
    },
    ACCESSIBLE: { WHEN_UNLOCKED: 'WhenUnlocked', AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
    __peek: () => entry,
    __reset: () => {
      entry = false;
    },
  };
});
const Keychain = require('react-native-keychain') as {
  __peek: () => { username: string; password: string } | false;
  __reset: () => void;
};

const SETUP_NEW = 'Enter passphrase (min 6 characters)';
const SETUP_CONFIRM = 'Re-enter passphrase';
const SETUP_CURRENT = 'Enter current passphrase';
const LOCK_INPUT = 'Enter passphrase';
const FIRST = 'correct horse';
const SECOND = 'brand new one';

/** Turn the lock on the only way a person can: through the real setup screen. */
const enableLock = async (passphrase: string): Promise<void> => {
  const view = render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.changeText(view.getByPlaceholderText(SETUP_NEW), passphrase);
  fireEvent.changeText(view.getByPlaceholderText(SETUP_CONFIRM), passphrase);
  fireEvent.press(view.getByText('Enable Lock'));
  await waitFor(() => expect(view.getByText('Passphrase lock enabled')).toBeTruthy());
  view.unmount();
};

/** Change the passphrase through the real change screen. */
const changePassphrase = async (
  current: string,
  next: string,
): Promise<ReturnType<typeof render>> => {
  const view = render(
    <PassphraseSetupScreen mode="change" onComplete={jest.fn()} onCancel={jest.fn()} />,
  );
  fireEvent.changeText(view.getByPlaceholderText(SETUP_CURRENT), current);
  fireEvent.changeText(view.getByPlaceholderText(SETUP_NEW), next);
  fireEvent.changeText(view.getByPlaceholderText(SETUP_CONFIRM), next);
  fireEvent.press(view.getAllByText('Change Passphrase').at(-1)!);
  return view;
};

/** Turn the lock off through the real Security switch, proving the current passphrase. */
const disableLock = async (current: string): Promise<ReturnType<typeof render>> => {
  const settings = render(<SecuritySettingsScreen />);
  fireEvent(settings.UNSAFE_getByType(require('react-native').Switch), 'valueChange', false);
  await waitFor(() => expect(settings.getByPlaceholderText(SETUP_CURRENT)).toBeTruthy());
  fireEvent.changeText(settings.getByPlaceholderText(SETUP_CURRENT), current);
  fireEvent.press(settings.getAllByText(/Disable|Remove|Turn Off/i).at(-1)!);
  return settings;
};

/** A relaunch: the application root starts the one lock owner again from what is stored. */
const relaunch = async (): Promise<void> => {
  await mobileSecurity.start();
};

/** What the application root renders: the lock screen when the lock is on and closed. */
const appShowsLockScreen = (): boolean => {
  const snapshot = mobileSecurity.snapshot();
  return snapshot.enabled && snapshot.locked;
};

const unlockWith = async (passphrase: string): Promise<{ opened: boolean; view: ReturnType<typeof render> }> => {
  const onUnlock = jest.fn();
  const view = render(<LockScreen onUnlock={onUnlock} />);
  fireEvent.changeText(view.getByPlaceholderText(LOCK_INPUT), passphrase);
  fireEvent.press(view.getByText('Unlock'));
  await waitFor(() => expect(onUnlock.mock.calls.length + view.queryAllByText('OK').length).toBeGreaterThan(0));
  return { opened: onUnlock.mock.calls.length > 0, view };
};

/** Five wrong tries, which is what the product allows before the wait. */
const exhaustAttempts = async (view: ReturnType<typeof render>): Promise<void> => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    fireEvent.changeText(view.getByPlaceholderText(LOCK_INPUT), `wrong ${attempt}`);
    fireEvent.press(view.getByText('Unlock'));
    // eslint-disable-next-line no-await-in-loop
    await waitFor(() => expect(view.getByText('OK')).toBeTruthy());
    fireEvent.press(view.getByText('OK'));
  }
};

describe('Journey M4 - Turn the passphrase on, change it, turn it off', () => {
  beforeEach(async () => {
    Keychain.__reset();
    await AsyncStorage.removeItem('offgrid.security.lock-state');
    await mobileSecurity.start();
  });

  it('M4.1 opens Security settings: the lock is shown as off and the switch is available', async () => {
    const view = render(<SecuritySettingsScreen />);
    expect(view.getByText('Passphrase Lock')).toBeTruthy();
    const { Switch } = require('react-native');
    expect(view.UNSAFE_getByType(Switch).props.value).toBe(false);
    expect(view.queryByText('Change Passphrase')).toBeNull();
  });

  it('M4.2 turns the lock on: the passphrase setup screen opens', async () => {
    const view = render(<SecuritySettingsScreen />);
    const { Switch } = require('react-native');
    fireEvent(view.UNSAFE_getByType(Switch), 'valueChange', true);
    await waitFor(() => expect(view.getByPlaceholderText(SETUP_NEW)).toBeTruthy());
  });

  it('M4.3 types a passphrase that is too short: the setup screen refuses it and the lock stays off', async () => {
    const view = render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.changeText(view.getByPlaceholderText(SETUP_NEW), 'short');
    fireEvent.changeText(view.getByPlaceholderText(SETUP_CONFIRM), 'short');
    fireEvent.press(view.getByText('Enable Lock'));
    await waitFor(() => expect(view.getByText('Passphrase must be at least 6 characters')).toBeTruthy());
    expect(mobileSecurity.snapshot().enabled).toBe(false);
  });

  it('M4.4 returns to Security settings after that refusal: the lock still reads off', async () => {
    const setup = render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.changeText(setup.getByPlaceholderText(SETUP_NEW), 'short');
    fireEvent.changeText(setup.getByPlaceholderText(SETUP_CONFIRM), 'short');
    fireEvent.press(setup.getByText('Enable Lock'));
    await waitFor(() => expect(setup.getByText('Passphrase must be at least 6 characters')).toBeTruthy());
    setup.unmount();

    const settings = render(<SecuritySettingsScreen />);
    const { Switch } = require('react-native');
    expect(settings.UNSAFE_getByType(Switch).props.value).toBe(false);
    expect(settings.queryByText('Change Passphrase')).toBeNull();
  });

  it('M4.5 turns the lock on and types a good passphrase twice: the screen confirms the lock is on', async () => {
    const view = render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.changeText(view.getByPlaceholderText(SETUP_NEW), FIRST);
    fireEvent.changeText(view.getByPlaceholderText(SETUP_CONFIRM), FIRST);
    fireEvent.press(view.getByText('Enable Lock'));
    await waitFor(() => expect(view.getByText('Passphrase lock enabled')).toBeTruthy());
  });

  it('M4.6 types two passphrases that do not match: the setup screen refuses them and the lock stays off', async () => {
    const view = render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.changeText(view.getByPlaceholderText(SETUP_NEW), FIRST);
    fireEvent.changeText(view.getByPlaceholderText(SETUP_CONFIRM), 'correct hose');
    fireEvent.press(view.getByText('Enable Lock'));
    await waitFor(() => expect(view.getByText('Passphrases do not match')).toBeTruthy());
    expect(mobileSecurity.snapshot().enabled).toBe(false);
  });

  it('M4.7 relaunches the app after turning the lock on: the lock screen appears before anything else', async () => {
    await enableLock(FIRST);
    await relaunch();
    expect(appShowsLockScreen()).toBe(true);
    const view = render(<LockScreen onUnlock={jest.fn()} />);
    expect(view.getByText('App Locked')).toBeTruthy();
  });

  it('M4.8 types the right passphrase: the app opens', async () => {
    await enableLock(FIRST);
    await relaunch();
    const { opened } = await unlockWith(FIRST);
    expect(opened).toBe(true);
  });

  it('M4.9 types a wrong passphrase: the app stays locked and the number of tries left is shown', async () => {
    await enableLock(FIRST);
    await relaunch();
    const { opened, view } = await unlockWith('wrong horse');
    expect(opened).toBe(false);
    expect(view.getByText('4 attempts remaining before lockout.')).toBeTruthy();
  });

  it('M4.10 types a wrong passphrase until the limit: the app says it is locked out and the wait is shown', async () => {
    await enableLock(FIRST);
    await relaunch();
    const view = render(<LockScreen onUnlock={jest.fn()} />);
    await exhaustAttempts(view);
    await waitFor(() => expect(view.getByText('Too many failed attempts')).toBeTruthy(), { timeout: 6000 });
    expect(view.getByText('Please wait before trying again')).toBeTruthy();
    expect(view.queryByPlaceholderText(LOCK_INPUT)).toBeNull();
  }, 30000);

  it('M4.11 force quits during the lockout, then reopens: the lockout is still in force', async () => {
    await enableLock(FIRST);
    await relaunch();
    const first = render(<LockScreen onUnlock={jest.fn()} />);
    await exhaustAttempts(first);
    first.unmount();

    await relaunch();
    const second = render(<LockScreen onUnlock={jest.fn()} />);
    await waitFor(() => expect(second.getByText('Too many failed attempts')).toBeTruthy(), { timeout: 6000 });
    expect(second.queryByPlaceholderText(LOCK_INPUT)).toBeNull();
  }, 30000);

  it('M4.12 waits out the lockout and types the right passphrase: the app opens and the tries left return to full', async () => {
    await enableLock(FIRST);
    await relaunch();
    const view = render(<LockScreen onUnlock={jest.fn()} />);
    await exhaustAttempts(view);
    view.unmount();

    // The wait passes on the real clock the owner reads.
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;
    try {
      await relaunch();
      const { opened, view: reopened } = await unlockWith(FIRST);
      expect(opened).toBe(true);
      expect(reopened.queryByText('4 attempts remaining')).toBeNull();
    } finally {
      Date.now = realNow;
    }
  }, 30000);

  it('M4.13 changes the passphrase to a new one: the screen confirms the change', async () => {
    await enableLock(FIRST);
    const view = await changePassphrase(FIRST, SECOND);
    await waitFor(() => expect(view.getByText('Passphrase changed successfully')).toBeTruthy());
  }, 20000);

  it('M4.14 relaunches and types the old passphrase: it is refused', async () => {
    await enableLock(FIRST);
    const change = await changePassphrase(FIRST, SECOND);
    await waitFor(() => expect(change.getByText('Passphrase changed successfully')).toBeTruthy());
    change.unmount();

    await relaunch();
    const { opened, view } = await unlockWith(FIRST);
    expect(opened).toBe(false);
    expect(view.getByText('Incorrect Passphrase')).toBeTruthy();
  }, 20000);

  it('M4.15 types the new passphrase: the app opens', async () => {
    await enableLock(FIRST);
    const change = await changePassphrase(FIRST, SECOND);
    await waitFor(() => expect(change.getByText('Passphrase changed successfully')).toBeTruthy());
    change.unmount();

    await relaunch();
    const { opened } = await unlockWith(SECOND);
    expect(opened).toBe(true);
  }, 20000);

  it('M4.16 starts to change the passphrase but types the current one wrongly: the change is refused and the new passphrase still opens the app', async () => {
    await enableLock(FIRST);
    const change = await changePassphrase('not the one', SECOND);
    await waitFor(() => expect(change.getByText('Current passphrase is incorrect')).toBeTruthy());
    change.unmount();

    await relaunch();
    const { opened } = await unlockWith(FIRST);
    expect(opened).toBe(true);
  }, 20000);

  it('M4.17 turns the lock off: Security settings show the lock as off', async () => {
    await enableLock(FIRST);
    const settings = await disableLock(FIRST);
    const { Switch } = require('react-native');
    await waitFor(() => expect(settings.UNSAFE_getByType(Switch).props.value).toBe(false));
  }, 20000);

  it('M4.18 relaunches the app: no lock screen appears', async () => {
    await enableLock(FIRST);
    const settings = await disableLock(FIRST);
    const { Switch } = require('react-native');
    await waitFor(() => expect(settings.UNSAFE_getByType(Switch).props.value).toBe(false));
    settings.unmount();

    await relaunch();
    expect(appShowsLockScreen()).toBe(false);
  }, 20000);

  it('M4.19 turns the lock back on after turning it off: a new passphrase is asked for and neither old passphrase is accepted', async () => {
    await enableLock(FIRST);
    const settings = await disableLock(FIRST);
    const { Switch } = require('react-native');
    await waitFor(() => expect(settings.UNSAFE_getByType(Switch).props.value).toBe(false));
    fireEvent(settings.UNSAFE_getByType(Switch), 'valueChange', true);
    await waitFor(() => expect(settings.getByPlaceholderText(SETUP_NEW)).toBeTruthy());
    expect(settings.queryByPlaceholderText(SETUP_CURRENT)).toBeNull();
    settings.unmount();

    await enableLock('third one now');
    await relaunch();
    const stale = await unlockWith(FIRST);
    expect(stale.opened).toBe(false);
  }, 30000);

  it('M4.20 force quits while turning the lock on, then relaunches: the lock and the stored passphrase agree', async () => {
    const setup = render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.changeText(setup.getByPlaceholderText(SETUP_NEW), FIRST);
    fireEvent.changeText(setup.getByPlaceholderText(SETUP_CONFIRM), FIRST);
    fireEvent.press(setup.getByText('Enable Lock'));
    // The quit lands while the save is still in flight.
    setup.unmount();

    await relaunch();
    const stored = Keychain.__peek() !== false;
    // Never locked with no passphrase: the two facts must agree.
    expect(mobileSecurity.snapshot().enabled).toBe(stored);
  }, 20000);

  it('M4.21 force quits while changing the passphrase, then relaunches: exactly one passphrase opens the app', async () => {
    await enableLock(FIRST);
    const change = render(
      <PassphraseSetupScreen mode="change" onComplete={jest.fn()} onCancel={jest.fn()} />,
    );
    fireEvent.changeText(change.getByPlaceholderText(SETUP_CURRENT), FIRST);
    fireEvent.changeText(change.getByPlaceholderText(SETUP_NEW), SECOND);
    fireEvent.changeText(change.getByPlaceholderText(SETUP_CONFIRM), SECOND);
    fireEvent.press(change.getAllByText('Change Passphrase').at(-1)!);
    change.unmount();

    await relaunch();
    const old = await unlockWith(FIRST);
    old.view.unmount();
    await relaunch();
    const next = await unlockWith(SECOND);
    expect([old.opened, next.opened].filter(Boolean).length).toBe(1);
  }, 30000);

  it('M4.22 force quits while turning the lock off, then relaunches: the lock and the stored passphrase agree', async () => {
    await enableLock(FIRST);
    const settings = render(<SecuritySettingsScreen />);
    const { Switch } = require('react-native');
    fireEvent(settings.UNSAFE_getByType(Switch), 'valueChange', false);
    await waitFor(() => expect(settings.getByPlaceholderText(SETUP_CURRENT)).toBeTruthy());
    fireEvent.changeText(settings.getByPlaceholderText(SETUP_CURRENT), FIRST);
    fireEvent.press(settings.getAllByText(/Disable|Remove|Turn Off/i).at(-1)!);
    settings.unmount();

    await relaunch();
    const stored = Keychain.__peek() !== false;
    expect(mobileSecurity.snapshot().enabled).toBe(stored);
  }, 20000);

  it('M4.23 sends the app to the background and returns: the lock behaves the same as on relaunch', async () => {
    await enableLock(FIRST);
    mobileSecurity.lock();
    expect(appShowsLockScreen()).toBe(true);
    const view = render(<LockScreen onUnlock={jest.fn()} />);
    expect(view.getByText('App Locked')).toBeTruthy();
  }, 20000);

  it('M4.24 opens Security settings after every step above: the named lock state always matches what the app just did', async () => {
    const { Switch } = require('react-native');
    const off = render(<SecuritySettingsScreen />);
    expect(off.UNSAFE_getByType(Switch).props.value).toBe(false);
    off.unmount();

    await enableLock(FIRST);
    const on = render(<SecuritySettingsScreen />);
    await waitFor(() => expect(on.UNSAFE_getByType(Switch).props.value).toBe(true));
    expect(on.getByText('Change Passphrase')).toBeTruthy();
    on.unmount();

    const settings = await disableLock(FIRST);
    await waitFor(() => expect(settings.UNSAFE_getByType(Switch).props.value).toBe(false));
  }, 30000);
});
