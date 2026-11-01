/**
 * deviceKeychain — the stateful keychain from keyedRemoteServer, plus control over WRITES: a write
 * can be refused (a locked keychain) or held until the test releases it (a slow secure-enclave
 * write). Our code imports react-native-keychain as a namespace copy, so a test cannot swap a
 * function on the module after import; the controls live here instead.
 *
 *   jest.mock('react-native-keychain', () => require('../../harness/deviceKeychain').deviceKeychainModule());
 */
import { keychainModule } from './keyedRemoteServer';

interface WriteControl {
  refuse?: string;
  hold?: Promise<void>;
}

const holder = globalThis as unknown as { __deviceKeychainWrites?: WriteControl };
const control = (): WriteControl => (holder.__deviceKeychainWrites ??= {});

export function deviceKeychainModule() {
  const base = keychainModule();
  return {
    ...base,
    setGenericPassword: async (username: string, password: string, options: { service: string }) => {
      const { refuse, hold } = control();
      if (hold) await hold;
      if (refuse) throw new Error(refuse);
      return base.setGenericPassword(username, password, options);
    },
  };
}

/** Every write from now on fails with this message; null lets writes through again. */
export function refuseKeychainWrites(message: string | null): void {
  control().refuse = message ?? undefined;
}

/** Writes wait until release() is called; returns the release. */
export function holdKeychainWrites(): () => void {
  let release!: () => void;
  control().hold = new Promise<void>(resolve => { release = resolve; });
  return () => {
    control().hold = undefined;
    release();
  };
}

/** Writes go straight through again. */
export function resetKeychainWrites(): void {
  holder.__deviceKeychainWrites = {};
}
