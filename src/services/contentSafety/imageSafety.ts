/**
 * Image safety check: every image an image model makes is classified on the device before anyone
 * sees it or it is saved. An image the classifier marks as nudity or sexual content is deleted.
 *
 * The classifier is Marqo/nsfw-image-detection-384 (Apache-2.0, ViT-tiny, labels NSFW / SFW),
 * exported to an executorch XNNPACK program and shipped inside the app (Android assets/models,
 * the iOS bundle). It needs no download and has no setting that turns it off.
 *
 * Fail closed: when the classifier cannot load or run, the image is treated as blocked. A check that
 * silently passes when it breaks would not be a check.
 *
 * The program loads for each check and is freed straight after, so it never stays in memory beside
 * the image or chat model (about 23 MB of weights for one pass of well under a second).
 */
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { ClassificationModule, initExecutorch } from 'react-native-executorch/legacy';
import { BareResourceFetcher } from 'react-native-executorch-bare-resource-fetcher';
import logger from '../../utils/logger';

const SAFETY_MODEL_FILENAME = 'nsfw_384_xnnpack_fp32.pte';

/** At or above this NSFW confidence the image is blocked. The model's own decision line is 0.5. */
const NSFW_THRESHOLD = 0.5;

const LABELS = { NSFW: 0, SFW: 1 } as const;
const PREPROCESS = { normMean: [0.5, 0.5, 0.5], normStd: [0.5, 0.5, 0.5] };

export type ImageVerdict =
  | { allowed: true; nsfw: number }
  | { allowed: false; nsfw: number | null; reason: 'nsfw' | 'check-failed' };

let fetcherReady = false;
let modelPathPromise: Promise<string> | null = null;
/** One check at a time: a second image waits for the first, so two programs never load at once. */
let queue: Promise<unknown> = Promise.resolve();

/** The classifier's path on disk. Android copies it out of the APK once; iOS reads the bundle. */
async function modelPath(): Promise<string> {
  if (Platform.OS !== 'android') return `${RNFS.MainBundlePath}/${SAFETY_MODEL_FILENAME}`;
  const dest = `${RNFS.DocumentDirectoryPath}/${SAFETY_MODEL_FILENAME}`;
  if (!(await RNFS.exists(dest))) {
    const tmp = `${dest}.part`;
    await RNFS.copyFileAssets(`models/${SAFETY_MODEL_FILENAME}`, tmp);
    await RNFS.moveFile(tmp, dest);
  }
  return dest;
}

function ensureModelPath(): Promise<string> {
  modelPathPromise ??= modelPath().catch(error => {
    modelPathPromise = null;
    throw error;
  });
  return modelPathPromise;
}

async function classify(imagePath: string): Promise<number> {
  if (!fetcherReady) {
    initExecutorch({ resourceFetcher: BareResourceFetcher });
    fetcherReady = true;
  }
  const path = await ensureModelPath();
  const classifier = await ClassificationModule.fromCustomModel(`file://${path}`, {
    labelMap: LABELS,
    preprocessorConfig: PREPROCESS,
  } as never);
  try {
    const uri = imagePath.startsWith('file://') ? imagePath : `file://${imagePath}`;
    const scores = (await classifier.forward(uri)) as Record<string, number>;
    const nsfw = scores.NSFW;
    if (typeof nsfw !== 'number' || !Number.isFinite(nsfw)) throw new Error('classifier returned no NSFW score');
    return nsfw;
  } finally {
    classifier.delete();
  }
}

/** Classify one generated image. Never throws: a failure is a blocked verdict. */
export function checkGeneratedImage(imagePath: string): Promise<ImageVerdict> {
  const run = queue.then(async (): Promise<ImageVerdict> => {
    try {
      const nsfw = await classify(imagePath);
      logger.log(`[ContentSafety] image nsfw=${nsfw.toFixed(3)}`);
      return nsfw >= NSFW_THRESHOLD ? { allowed: false, nsfw, reason: 'nsfw' } : { allowed: true, nsfw };
    } catch (error) {
      logger.error('[ContentSafety] image check failed; image blocked', error);
      return { allowed: false, nsfw: null, reason: 'check-failed' };
    }
  });
  // run never rejects (every failure is a blocked verdict), so the queue never breaks.
  queue = run;
  return run;
}
