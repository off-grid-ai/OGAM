/**
 * The phone's "What it does for you": the shared topic list (@offgrid/models, the same words the
 * desktop guide shows) plus what is the phone's own - a Feather icon, a picture when there is a
 * good one, and the screen a topic opens here.
 */
import type { ImageSourcePropType } from 'react-native';
import { MOBILE_GUIDE_GROUPS, guideTopicsFor, type GuideTopicFacts } from '@offgrid/models';

export interface GuideMedia {
  dark: ImageSourcePropType;
  light: ImageSourcePropType;
  /** Width over height, so the frame holds its shape before the picture decodes. */
  aspect: number;
  /** A short clip of it in use (a required mp4), played in place of the still. */
  clip?: number;
}

/** Where a topic leads on this phone. Pro ones lead to Get Pro until Pro is active. */
export type GuideOpen =
  | 'chat'
  | 'projects'
  | 'models'
  | 'notes'
  | 'vault'
  | 'sync'
  | 'clipboard'
  | 'tools';

export interface MobileGuideTopic extends GuideTopicFacts {
  group: string;
  icon: string;
  media?: GuideMedia;
  open?: GuideOpen;
}

export const GUIDE_GROUPS = MOBILE_GUIDE_GROUPS;

const ICONS: Record<string, string> = {
  'phone-chat': 'message-circle',
  'phone-images': 'image',
  'phone-vision': 'eye',
  'phone-speech': 'mic',
  'phone-documents': 'file-text',
  'phone-voice': 'volume-2',
  'phone-video': 'film',
  'phone-notes': 'edit',
  'phone-improve': 'edit-3',
  'phone-vault': 'lock',
  'phone-clipboard': 'clipboard',
  'phone-sync': 'refresh-cw',
  'phone-tools': 'terminal',
  'phone-models': 'box',
  computer: 'monitor',
  extension: 'globe',
};

const tall = 0.85;
const MEDIA: Record<string, GuideMedia> = {
  'phone-chat': {
    dark: require('../../assets/guide/phone-dark.webp'),
    light: require('../../assets/guide/phone-light.webp'),
    aspect: tall,
  },
  'phone-voice': {
    dark: require('../../assets/guide/phone-voice-dark.webp'),
    light: require('../../assets/guide/phone-voice-light.webp'),
    aspect: 0.92,
  },
  computer: {
    dark: require('../../assets/guide/day-dark.webp'),
    light: require('../../assets/guide/day-light.webp'),
    aspect: 1760 / 1137,
  },
  extension: {
    dark: require('../../assets/guide/extension-dark.webp'),
    light: require('../../assets/guide/extension-light.webp'),
    aspect: 1600 / 750,
  },
  // Real phone screens from the screen reviews (mobile/docs/review) and the release shots, cropped
  // to the part that shows the feature. One take each, so both themes show it.
  'phone-images': screen(require('../../assets/guide/phone-images.webp'), 600 / 652),
  // A real Video Studio run on iPhone through OpenRouter (17 Nov): the wait, Ready, then the film at 30 fps.
  'phone-video': screen(require('../../assets/guide/phone-video.webp'), 400 / 870, require('../../assets/guide/phone-video.mp4')),
  'phone-notes': screen(require('../../assets/guide/phone-notes.webp'), 480 / 640, require('../../assets/guide/phone-notes.mp4')),
  'phone-improve': screen(require('../../assets/guide/phone-improve.webp'), 480 / 600, require('../../assets/guide/phone-improve.mp4')),
  'phone-vault': screen(require('../../assets/guide/phone-vault.webp'), 600 / 925),
  'phone-sync': screen(require('../../assets/guide/phone-sync.webp'), 600 / 745),
  'phone-tools': screen(require('../../assets/guide/phone-tools.webp'), 600 / 802),
  'phone-models': screen(require('../../assets/guide/phone-models.webp'), 600 / 802),
  // The store shots' phone pairs (website/output/store-assets), cropped like Chat above.
  'phone-vision': {
    dark: require('../../assets/guide/phone-vision-dark.webp'),
    light: require('../../assets/guide/phone-vision-light.webp'),
    aspect: tall,
  },
  'phone-speech': {
    dark: require('../../assets/guide/phone-speech-dark.webp'),
    light: require('../../assets/guide/phone-speech-light.webp'),
    aspect: tall,
  },
  'phone-documents': {
    dark: require('../../assets/guide/phone-documents-dark.webp'),
    light: require('../../assets/guide/phone-documents-light.webp'),
    aspect: tall,
  },
  'phone-clipboard': {
    dark: require('../../assets/guide/phone-clipboard-dark.webp'),
    light: require('../../assets/guide/phone-clipboard-light.webp'),
    aspect: 1200 / 555,
  },
};

function screen(source: GuideMedia['light'], aspect: number, clip?: number): GuideMedia {
  return { dark: source, light: source, aspect, clip };
}

const OPEN: Record<string, GuideOpen> = {
  'phone-chat': 'chat',
  'phone-images': 'chat',
  'phone-vision': 'chat',
  'phone-speech': 'chat',
  'phone-voice': 'chat',
  'phone-video': 'chat',
  'phone-documents': 'projects',
  'phone-models': 'models',
  'phone-notes': 'notes',
  'phone-improve': 'notes',
  'phone-vault': 'vault',
  'phone-clipboard': 'clipboard',
  'phone-sync': 'sync',
  'phone-tools': 'tools',
};

/** Every topic this phone's guide shows, in page order within each group. */
export function mobileGuideTopics(): MobileGuideTopic[] {
  return guideTopicsFor('mobile').map(t => ({
    ...t,
    icon: ICONS[t.id] ?? 'info',
    media: MEDIA[t.id],
    open: OPEN[t.id],
  }));
}

/** The first look under the Ask box: the topics with a picture. */
export function firstLookTopics(topics: MobileGuideTopic[], ids: readonly string[]): MobileGuideTopic[] {
  return ids
    .map(id => topics.find(t => t.id === id))
    .filter((t): t is MobileGuideTopic => Boolean(t?.media));
}
