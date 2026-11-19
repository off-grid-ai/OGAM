/**
 * The share loop: an image you made, or a reply you liked, goes out through the system share sheet with
 * a small mark ("Made offline on my phone · Off Grid AI") on the picture and the plain download link
 * in the share text. No tracking, no tagged link, no event: installs show up as direct and web installs.
 *
 * ShareCardHost (mounted once at the app root) draws the card off screen and captures it as a PNG; this
 * service asks it for one and hands the file to the share sheet. The plain Save and Copy actions stay as
 * they are.
 */
import { NativeModules, Platform, Share } from 'react-native';
import { resolveDocumentPath } from '../../utils/resolveDocumentPath';

/** Mac's words (2026-11-19). */
export const SHARE_MARK = 'Made offline on my phone · Off Grid AI';
export const SHARE_LINK = 'https://getoffgridai.co/download';

/** The text beside the shared picture: the mark, then the plain link. */
export function shareText(): string {
  return `${SHARE_MARK}\n${SHARE_LINK}`;
}

export type ShareCard = { kind: 'image'; path: string } | { kind: 'reply'; text: string };

type Renderer = (card: ShareCard) => Promise<string>;
let renderer: Renderer | null = null;

/** ShareCardHost registers how it draws a card; it returns the PNG's path. */
export function registerShareCardRenderer(next: Renderer | null): void {
  renderer = next;
}

/** A reply longer than a card holds ends with an ellipsis; the full text stays in the chat. */
export const REPLY_CARD_MAX_CHARS = 700;

export function replyCardText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= REPLY_CARD_MAX_CHARS) return trimmed;
  const cut = trimmed.slice(0, REPLY_CARD_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > REPLY_CARD_MAX_CHARS * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

async function shareCard(card: ShareCard): Promise<void> {
  if (!renderer) throw new Error('The share card is not ready yet.');
  const png = await renderer(card);
  if (Platform.OS === 'ios') {
    await Share.share({ url: `file://${png}`, message: shareText() });
    return;
  }
  await NativeModules.MediaShareModule.shareFileWithText(png, 'image/png', shareText());
}

/** An image you made, with the mark under it. */
export function shareMarkedImage(imagePath: string): Promise<void> {
  return shareCard({ kind: 'image', path: resolveDocumentPath(imagePath) });
}

/** A reply as a card, with the mark under it. */
export function shareReplyCard(text: string): Promise<void> {
  return shareCard({ kind: 'reply', text: replyCardText(text) });
}
