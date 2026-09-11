import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createHydrationGatedStorage } from '../utils/hydrationGatedStorage';

interface AuthState {
  isEnabled: boolean;
  isLocked: boolean;
  failedAttempts: number;
  lockoutUntil: number | null;
  lastBackgroundTime: number | null;

  // Actions
  setEnabled: (enabled: boolean) => void;
  setLocked: (locked: boolean) => void;
  recordFailedAttempt: () => boolean; // Returns true if lockout triggered
  resetFailedAttempts: () => void;
  setLastBackgroundTime: (time: number | null) => void;
  checkLockout: () => boolean; // Returns true if currently locked out
  getLockoutRemaining: () => number; // Returns seconds remaining
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

type PersistedAuthState = Pick<AuthState, 'isEnabled' | 'failedAttempts' | 'lockoutUntil'>;
const authStorage = createHydrationGatedStorage<PersistedAuthState>();

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isEnabled: false,
      isLocked: true, // Always start locked if enabled
      failedAttempts: 0,
      lockoutUntil: null,
      lastBackgroundTime: null,

      setEnabled: (enabled) => {
        set({ isEnabled: enabled, isLocked: enabled });
      },

      setLocked: (locked) => {
        set({ isLocked: locked });
      },

      recordFailedAttempt: () => {
        const { failedAttempts } = get();
        const newAttempts = failedAttempts + 1;

        if (newAttempts >= MAX_FAILED_ATTEMPTS) {
          const lockoutUntil = Date.now() + LOCKOUT_DURATION;
          set({
            failedAttempts: newAttempts,
            lockoutUntil,
          });
          return true;
        }

        set({ failedAttempts: newAttempts });
        return false;
      },

      resetFailedAttempts: () => {
        set({ failedAttempts: 0, lockoutUntil: null });
      },

      setLastBackgroundTime: (time) => {
        set({ lastBackgroundTime: time });
      },

      checkLockout: () => {
        const { lockoutUntil } = get();
        if (!lockoutUntil) return false;

        if (Date.now() >= lockoutUntil) {
          set({ lockoutUntil: null, failedAttempts: 0 });
          return false;
        }

        return true;
      },

      getLockoutRemaining: () => {
        const { lockoutUntil } = get();
        if (!lockoutUntil) return 0;

        const remaining = Math.max(0, lockoutUntil - Date.now());
        return Math.ceil(remaining / 1000);
      },
    }),
    {
      name: 'local-llm-auth-storage',
      storage: authStorage.storage,
      onRehydrateStorage: () => () => authStorage.markHydrated(),
      partialize: (state): PersistedAuthState => ({
        isEnabled: state.isEnabled,
        failedAttempts: state.failedAttempts,
        lockoutUntil: state.lockoutUntil,
      }),
    }
  )
);
