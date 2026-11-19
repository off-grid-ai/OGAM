import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import RNFS from 'react-native-fs';
import ViewShot from 'react-native-view-shot';
import { COLORS_LIGHT } from '@offgrid/design';
import { FONTS } from '../../constants';
import { registerShareCardRenderer, SHARE_MARK, type ShareCard } from '../../services/shareCard';

/** Card width in points; captured at 3x, so 1080 px wide, the size messaging apps show in full. */
const CARD_WIDTH = 360;
const SHARE_DIR = `${RNFS.DocumentDirectoryPath}/share-cards`;

interface Pending {
  card: ShareCard;
  resolve: (path: string) => void;
  reject: (error: Error) => void;
}

/**
 * Draws the share card off screen and captures it (services/shareCard). Mounted once at the app root.
 * The card is always light: a shared picture reads the same in every chat it lands in.
 */
export const ShareCardHost: React.FC = () => {
  const shot = useRef<React.ComponentRef<typeof ViewShot>>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    registerShareCardRenderer(card => new Promise<string>((resolve, reject) => {
      setImageSize(null);
      setPending({ card, resolve, reject });
    }));
    return () => registerShareCardRenderer(null);
  }, []);

  // Never throws: every outcome settles the pending share.
  const capture = useCallback(async () => {
    const job = pending as Pending;
    try {
      const tmp = await shot.current!.capture!();
      // The share sheet reads files from the app's own folder (Android's FileProvider root).
      await RNFS.unlink(SHARE_DIR).catch(() => {});
      await RNFS.mkdir(SHARE_DIR);
      const path = `${SHARE_DIR}/off-grid-ai-${Date.now()}.png`;
      await RNFS.moveFile(tmp.replace(/^file:\/\//, ''), path);
      job.resolve(path);
    } catch (error) {
      job.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setPending(null);
    }
  }, [pending]);

  // An image card waits for the image's size, then for the next frame; a reply card for its layout.
  useEffect(() => {
    if (pending?.card.kind !== 'image') return;
    const { path } = pending.card;
    Image.getSize(`file://${path}`, (width, height) => setImageSize({ width, height }),
      () => { pending.reject(new Error('The image could not be read.')); setPending(null); });
  }, [pending]);

  if (!pending) return null;
  const { card } = pending;
  return (
    <View style={styles.offscreen} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <ViewShot ref={shot} options={{ format: 'png', result: 'tmpfile', width: CARD_WIDTH * 3 }}>
        <View style={styles.card} testID="share-card">
          {card.kind === 'image' ? (
            imageSize ? (
              <Image
                source={{ uri: `file://${card.path}` }}
                style={[styles.image, { aspectRatio: imageSize.width / imageSize.height }]}
                onLoad={() => requestAnimationFrame(() => { capture(); })}
                testID="share-card-image"
              />
            ) : null
          ) : (
            <View style={styles.reply} testID="share-card-reply-box" onLayout={() => requestAnimationFrame(() => { capture(); })}>
              <Text style={styles.replyText} testID="share-card-reply">{card.text}</Text>
            </View>
          )}
          <View style={styles.mark}>
            <Image source={require('../../assets/logo.png')} style={styles.logo} />
            <Text style={styles.markText}>{SHARE_MARK}</Text>
          </View>
        </View>
      </ViewShot>
    </View>
  );
};

const styles = StyleSheet.create({
  offscreen: { position: 'absolute', left: -10000, top: 0, width: CARD_WIDTH },
  card: { width: CARD_WIDTH, backgroundColor: COLORS_LIGHT.background },
  image: { width: CARD_WIDTH },
  reply: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 20 },
  replyText: { fontFamily: FONTS.sans, fontSize: 17, lineHeight: 25, color: COLORS_LIGHT.text },
  mark: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS_LIGHT.border,
  },
  logo: { width: 18, height: 18, borderRadius: 4 },
  markText: { fontFamily: FONTS.sans, fontSize: 13, color: COLORS_LIGHT.textMuted },
});
