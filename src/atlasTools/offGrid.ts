import { useOffGrid, offGridOn, NETWORK_TOOLS } from './offGridState';
import { useLowPower } from './lowPowerState';

export { useOffGrid, offGridOn };

/**
 * Off-grid mode: one switch for "no internet, save battery, emergency first".
 *  - Atlas agent becomes active
 *  - internet tools (web search, read web page) are not offered to the model
 *  - low-battery mode is switched on
 *  - the emergency screens use a red-on-black night palette (protects night vision, saves OLED battery)
 */
/** Switches off-grid mode on or off. Switching it on also makes the Atlas agent active and turns low-battery mode on. */
export function setOffGrid(on: boolean): void {
  useOffGrid.getState().setOn(on);
  if (!on) return;
  try { require('../stores/agentStore').useAgentStore.getState().setActiveAgent('atlas'); } catch { /* ignore */ }
  useLowPower.getState().set({ enabled: true });
}

export { NETWORK_TOOLS };

export const NIGHT_COLORS: any = {
  background: '#000000', surface: '#160303', surfaceLight: '#220505', text: '#FF5A5A', textSecondary: '#D24848',
  textMuted: '#9E3434', border: '#3A0A0A', primary: '#FF3B3B', error: '#FF3B3B',
};

/** Colors for the emergency screens: red night palette when switched on. */
export function useEmergencyColors(base: any): any {
  const night = useOffGrid((s) => s.nightRed);
  return night ? { ...base, ...NIGHT_COLORS } : base;
}
