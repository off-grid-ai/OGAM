import {
  NativeEventEmitter,
  NativeModules,
  Platform,
  type EmitterSubscription,
} from 'react-native';

const CLIPBOARD_CHANGED_EVENT = 'SyncClipboardChanged';
const PROCESS_TEXT_AVAILABLE_EVENT = 'SyncProcessTextAvailable';

export interface NativeClipboardChange {
  text: string;
  ts: number;
}

interface PendingNativeClipboardText extends NativeClipboardChange {
  id: string;
}

interface SyncClipboardNativeModule {
  setEnabled(enabled: boolean): void;
  writeText(text: string): void;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  /** Android only. iOS has no PROCESS_TEXT handoff queue. */
  readPendingProcessText?(): Promise<unknown>;
  /** Android only. Removes handoffs after the coordinator has handled them. */
  acknowledgePendingProcessText?(ids: string[]): Promise<void>;
}

export interface NativeClipboardBoundary {
  observe(listener: (change: NativeClipboardChange) => void): () => void;
  writeText(text: string): void;
  /** Android blocks automatic clipboard reads while another app has focus. */
  ambientExternalCaptureAvailable(): boolean;
  /** Durable text the user explicitly sent through Android's PROCESS_TEXT action. */
  pendingLocalText(): Promise<PendingNativeClipboardText[]>;
  acknowledgePendingLocalText(ids: string[]): Promise<void>;
  onPendingLocalTextAvailable(listener: () => void): () => void;
}

function module(): SyncClipboardNativeModule {
  const nativeModule = NativeModules.SyncClipboardModule as
    | SyncClipboardNativeModule
    | undefined;
  if (!nativeModule) {
    throw new Error('Native clipboard sync is unavailable in this build.');
  }
  return nativeModule;
}

export const nativeClipboardBoundary: NativeClipboardBoundary = {
  observe(listener): () => void {
    const nativeModule = module();
    const emitter = new NativeEventEmitter(nativeModule);
    const subscription: EmitterSubscription = emitter.addListener(
      CLIPBOARD_CHANGED_EVENT,
      (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        const change = value as Partial<NativeClipboardChange>;
        if (typeof change.text !== 'string' || typeof change.ts !== 'number') {
          return;
        }
        const timestamp = Math.trunc(change.ts);
        if (!Number.isSafeInteger(timestamp)) return;
        listener({ text: change.text, ts: timestamp });
      },
    );
    nativeModule.setEnabled(true);
    return () => {
      nativeModule.setEnabled(false);
      subscription.remove();
    };
  },

  writeText(text): void {
    module().writeText(text);
  },

  ambientExternalCaptureAvailable(): boolean {
    return Platform.OS !== 'android';
  },

  async pendingLocalText(): Promise<PendingNativeClipboardText[]> {
    if (Platform.OS !== 'android') return [];
    const nativeModule = module();
    if (!nativeModule.readPendingProcessText) return [];
    const value = await nativeModule.readPendingProcessText();
    if (!Array.isArray(value)) return [];
    return value.flatMap(candidate => {
      if (!candidate || typeof candidate !== 'object') return [];
      const item = candidate as Partial<PendingNativeClipboardText>;
      if (
        typeof item.id !== 'string' ||
        item.id.length === 0 ||
        typeof item.text !== 'string' ||
        typeof item.ts !== 'number'
      ) {
        return [];
      }
      const timestamp = Math.trunc(item.ts);
      if (!Number.isSafeInteger(timestamp)) return [];
      return [{ id: item.id, text: item.text, ts: timestamp }];
    });
  },

  async acknowledgePendingLocalText(ids): Promise<void> {
    if (Platform.OS !== 'android' || ids.length === 0) return;
    await module().acknowledgePendingProcessText?.(ids);
  },

  onPendingLocalTextAvailable(listener): () => void {
    // PROCESS_TEXT is an Android activity handoff. Asking iOS to subscribe to its event makes
    // RCTEventEmitter report an unsupported event during every clipboard-sync startup.
    if (Platform.OS !== 'android') return () => undefined;
    const nativeModule = module();
    const emitter = new NativeEventEmitter(nativeModule);
    const subscription = emitter.addListener(
      PROCESS_TEXT_AVAILABLE_EVENT,
      listener,
    );
    return () => subscription.remove();
  },
};
