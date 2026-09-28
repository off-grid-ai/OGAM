// Durable storage for the lock facts. The record is written and read verbatim; this adapter
// never interprets it, because the Shared security owner decides what the facts mean.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersistedSecurityState, SecurityStatePort } from '@offgrid/application';
import logger from '../../../utils/logger';

const STORAGE_KEY = 'offgrid.security.lock-state';

export const mobileSecurityStatePort: SecurityStatePort = {
  async read() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as PersistedSecurityState) : null;
    } catch (error) {
      logger.error('Failed to read the lock state:', error);
      return null;
    }
  },
  async write(state) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  },
};
