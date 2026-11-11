import { useLowPower, lowPowerEnabled, lowPowerActive, LOW_POWER_NOTE } from './lowPowerState';

export { useLowPower, lowPowerEnabled, lowPowerActive, LOW_POWER_NOTE };

/** The text model that uses the least battery per answer: fastest measured on this phone, else the smallest file. */
export function batteryModel(): { id: string; why: string } | null {
  try {
    const { useAppStore } = require('../stores/appStore');
    const { useSpeedStats } = require('./speed');
    const models: any[] = useAppStore.getState().downloadedModels || [];
    if (models.length < 2) return null;
    const sp = useSpeedStats.getState().byModel;
    const timed = models.filter((m) => sp[m.id]?.decode).sort((a, b) => sp[b.id].decode - sp[a.id].decode);
    if (timed.length >= 2) return { id: timed[0].id, why: `fastest on this phone (~${Math.round(sp[timed[0].id].decode * 0.75)} words/s)` };
    const small = [...models].sort((a, b) => (a.fileSize || 0) - (b.fileSize || 0))[0];
    return { id: small.id, why: 'smallest model you have' };
  } catch { return null; }
}

let timer: ReturnType<typeof setInterval> | null = null;

async function check(): Promise<void> {
  try {
    const DeviceInfo = require('react-native-device-info').default;
    const level: number = await DeviceInfo.getBatteryLevel();
    const charging: boolean = await DeviceInfo.isBatteryCharging();
    const pct = Math.round(level * 100);
    const s = useLowPower.getState();
    s.set({ battery: pct, charging });
    if (!lowPowerEnabled()) {
      if (s.active) s.set({ active: false });
      return;
    }
    const { useAppStore } = require('../stores/appStore');
    const { switchToModelInBackground } = require('./models');
    if (!s.active && !charging && pct >= 0 && pct <= s.threshold) {
      const prev = useAppStore.getState().loadedTextModelId || useAppStore.getState().activeModelId || '';
      s.set({ active: true, prevModelId: prev });
      try { require('../atlasVoice/store').useAtlasVoiceStore.getState().setHandsFree(false); } catch { /* ignore */ }
      const target = s.modelId || batteryModel()?.id || '';
      if (target && target !== prev) { s.set({ switchedTo: target }); switchToModelInBackground(target); }
    } else if (s.active && (charging || pct > s.threshold + 5)) {
      s.set({ active: false });
      const to = useLowPower.getState().switchedTo;
      s.set({ switchedTo: '' });
      if (s.prevModelId && to && s.prevModelId !== to) switchToModelInBackground(s.prevModelId);
    }
  } catch { /* battery info unavailable */ }
}

export function startLowPowerMonitor(): void {
  if (timer) return;
  void check();
  timer = setInterval(() => { void check(); }, 60000);
}

export const checkBatteryNow = check;
