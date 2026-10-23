/**
 * The ONE module that imports the PostHog SDK. It builds a client with every privacy option the
 * spec requires (docs/ANALYTICS.md) and gives the analytics owner four verbs: capture, screen,
 * register, and shut down (keeping or forgetting the anonymous ID).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import PostHog, { PostHogPersistedProperty } from 'posthog-react-native';
import { POSTHOG_API_KEY, POSTHOG_HOST } from '../../config/analytics';
import { ignore, languageOnly } from './values';

type Properties = Record<string, unknown>;
type CaptureEvent = { event: string; properties?: Properties };

/**
 * Remote config is fetched on every start and cannot be switched off by an option. This app uses
 * no flags, surveys or remote settings, so the client skips the request: the only requests it
 * makes are event batches.
 */
class OffGridPostHog extends PostHog {
  reloadRemoteConfigAsync(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}

export interface AnalyticsClientOptions {
  crashes: boolean;
  /** Return the event to send, or null to drop it. */
  beforeSend: (event: CaptureEvent) => CaptureEvent | null;
}

export interface AnalyticsClient {
  capture(event: string, properties?: Properties): void;
  screen(name: string, properties?: Properties): void;
  register(properties: Properties): void;
  /** Send what is queued and stop. The anonymous ID is kept. */
  close(): Promise<void>;
  /** Opt-out: drop what is queued, reset the anonymous ID and stop. */
  forget(): Promise<void>;
}

/** Debug builds and a missing key never create the SDK. */
export function analyticsBuildAllowed(): boolean {
  return !__DEV__ && POSTHOG_API_KEY.length > 0;
}

function appProperties<T extends { $locale?: string | null; $timezone?: string | null }>(props: T): T {
  return { ...props, $timezone: null, $locale: languageOnly(props.$locale ?? undefined) };
}

export function createAnalyticsClient(options: AnalyticsClientOptions): AnalyticsClient {
  const posthog = new OffGridPostHog(POSTHOG_API_KEY, {
    host: POSTHOG_HOST,
    persistence: 'file',
    // The app's own AsyncStorage, named explicitly rather than discovered as an optional peer.
    customStorage: AsyncStorage,
    // The app sends its own `app_opened` / `app_backgrounded`. The SDK's lifecycle events are not
    // in the spec, and its "Application Opened" carries the deep link URL the app opened with.
    captureAppLifecycleEvents: false,
    enableSessionReplay: false,
    preloadFeatureFlags: false,
    disableRemoteFeatureFlags: true,
    disableSurveys: true,
    disableGeoip: true,
    personProfiles: 'never',
    setDefaultPersonProperties: false,
    capturePushNotificationSubscriptions: false,
    capturePushNotificationOpened: false,
    customAppProperties: appProperties,
    errorTracking: {
      autocapture: options.crashes
        ? { uncaughtExceptions: true, unhandledRejections: true, console: false, nativeCrashes: false }
        : false,
      exceptionSteps: { enabled: false },
    },
    before_send: event => options.beforeSend(event as CaptureEvent) as typeof event | null,
  });

  return {
    capture: (event, properties) => posthog.capture(event, properties as never),
    screen: (name, properties) => {
      posthog.screen(name, properties as never).catch(ignore);
    },
    register: properties => {
      posthog.register(properties as never).catch(ignore);
    },
    close: () => posthog.shutdown(),
    forget: async () => {
      await posthog.optOut();
      posthog.setPersistedProperty(PostHogPersistedProperty.Queue, null);
      posthog.reset();
      await posthog.shutdown();
    },
  };
}
