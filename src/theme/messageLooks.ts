/**
 * Chat looks borrowed from messaging apps: the colours, corner shapes and widths of each app's bubbles. The colours are
 * fixed (a green bubble is what makes it WhatsApp), with a light and a dark version chosen from the screen's background.
 * Pure, so it is tested without a device.
 */
export type MessageLook = 'imessage' | 'sms' | 'whatsapp' | 'messenger' | 'telegram' | 'discord';

export const MESSAGE_LOOKS: Array<{ id: MessageLook; name: string; hint: string }> = [
  { id: 'imessage', name: 'iMessage', hint: 'Blue bubbles for you, grey for the reply, big round corners' },
  { id: 'sms', name: 'Text message', hint: 'Green bubbles for you, grey for the reply' },
  { id: 'whatsapp', name: 'WhatsApp style', hint: 'Soft green for you, white for the reply, small tails' },
  { id: 'messenger', name: 'Messenger style', hint: 'Bright blue for you, light grey for the reply' },
  { id: 'telegram', name: 'Telegram style', hint: 'Pale green or deep blue for you, plain for the reply' },
  { id: 'discord', name: 'Discord style', hint: 'No bubbles: full-width rows with a name above each' },
];

export const isMessageLook = (v: unknown): v is MessageLook => MESSAGE_LOOKS.some((l) => l.id === v);

/** True when a #rgb / #rrggbb background is dark. */
export function isDarkColor(hex: string | undefined): boolean {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return false;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

export interface MessageLookStyle {
  /** Style for the bubble (box around the message). */
  bubble: Record<string, unknown>;
  /** Text colour that reads on that bubble. */
  textColor: string;
  /** A small name above the message (Discord style), or undefined. */
  label?: string;
}

interface Palette { me: string; meText: string; them: string; themText: string }

const PALETTES: Record<Exclude<MessageLook, 'discord'>, { light: Palette; dark: Palette; radius: number; tail: number }> = {
  imessage: { radius: 20, tail: 6,
    light: { me: '#0B84FF', meText: '#FFFFFF', them: '#E9E9EB', themText: '#000000' },
    dark: { me: '#0B84FF', meText: '#FFFFFF', them: '#26262A', themText: '#FFFFFF' } },
  sms: { radius: 16, tail: 4,
    light: { me: '#2E9E48', meText: '#FFFFFF', them: '#E9E9EB', themText: '#000000' },
    dark: { me: '#2A9D45', meText: '#FFFFFF', them: '#26262A', themText: '#FFFFFF' } },
  whatsapp: { radius: 10, tail: 2,
    light: { me: '#D9FDD3', meText: '#111B21', them: '#FFFFFF', themText: '#111B21' },
    dark: { me: '#005C4B', meText: '#E9EDEF', them: '#202C33', themText: '#E9EDEF' } },
  messenger: { radius: 18, tail: 4,
    light: { me: '#0084FF', meText: '#FFFFFF', them: '#E4E6EB', themText: '#050505' },
    dark: { me: '#0084FF', meText: '#FFFFFF', them: '#3A3B3C', themText: '#E4E6EB' } },
  telegram: { radius: 14, tail: 3,
    light: { me: '#EFFDDE', meText: '#000000', them: '#FFFFFF', themText: '#000000' },
    dark: { me: '#2B5278', meText: '#FFFFFF', them: '#182533', themText: '#FFFFFF' } },
};

/** The chat screen's background in a messaging-app look (WhatsApp's beige, Telegram's blue-grey...), or undefined to keep the app's own. */
const BACKGROUNDS: Record<MessageLook, { light: string; dark: string }> = {
  imessage: { light: '#FFFFFF', dark: '#000000' },
  sms: { light: '#FFFFFF', dark: '#000000' },
  whatsapp: { light: '#EFEAE2', dark: '#0B141A' },
  messenger: { light: '#FFFFFF', dark: '#18191A' },
  telegram: { light: '#DDE5EC', dark: '#0E1621' },
  discord: { light: '#FFFFFF', dark: '#313338' },
};
export const lookBackground = (look: MessageLook, dark: boolean): string => BACKGROUNDS[look][dark ? 'dark' : 'light'];

/** "9:41 PM" for a message time (the locale's own style). */
export const messageTime = (timestamp: number): string => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** How one message looks in a messaging-app look. `dark` is whether the screen background is dark. */
export function messageLookStyle(look: MessageLook, isUser: boolean, dark: boolean): MessageLookStyle {
  if (look === 'discord') {
    const base = dark ? '#313338' : '#F2F3F5';
    return {
      bubble: { backgroundColor: isUser ? 'transparent' : dark ? '#2B2D31' : base, borderRadius: 6, maxWidth: '100%', width: '100%', minWidth: undefined, paddingHorizontal: 12, paddingVertical: 8 },
      textColor: dark ? '#DBDEE1' : '#2E3338',
      label: isUser ? 'You' : 'Assistant',
    };
  }
  const spec = PALETTES[look];
  const p = dark ? spec.dark : spec.light;
  return {
    bubble: {
      backgroundColor: isUser ? p.me : p.them,
      borderRadius: spec.radius,
      // The corner by the sender is squarer, like a speech tail.
      ...(isUser ? { borderBottomRightRadius: spec.tail } : { borderBottomLeftRadius: spec.tail }),
      maxWidth: '80%', minWidth: undefined,
      paddingHorizontal: 14, paddingVertical: 8,
    },
    textColor: isUser ? p.meText : p.themText,
  };
}

/**
 * The look for one message and the chat styles to draw it with. A messaging-app look sets its own bubble colours, so the
 * text colour is set to match. Returns the styles unchanged (and no look) for Clean and Bubbles.
 */
export function applyMessageLook<S extends { userText: object; assistantText: object }>(o: {
  layout: string; isUser: boolean; background: string; styles: S;
}): { look?: MessageLookStyle; lookStyles: S; timeStyle?: object } {
  if (!isMessageLook(o.layout)) return { lookStyles: o.styles };
  const look = messageLookStyle(o.layout, o.isUser, isDarkColor(o.background));
  const lookStyles = { ...o.styles, userText: { ...o.styles.userText, color: look.textColor }, assistantText: { ...o.styles.assistantText, color: look.textColor } };
  return { look, lookStyles, timeStyle: { color: look.textColor, opacity: 0.6, fontSize: 11, alignSelf: 'flex-end', marginTop: 2 } };
}
