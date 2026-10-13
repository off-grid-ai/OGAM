/**
 * nativeImageLoader — the native image decoder, as a boundary fake.
 *
 * In the jest renderer an <Image> never loads anything: no native view exists to decode its source,
 * so `onLoad`/`onError` never fire. On a device they fire from the native side depending on ONE fact:
 * whether the file the source names is actually there. This reproduces that fact and nothing else.
 *
 * `decodeRenderedImages` walks every rendered host Image with a `file://` source, asks the stateful
 * filesystem fake whether that file exists, and fires the Image's own `onLoad` when it does and
 * `onError` when it does not - exactly what the native decoder reports. It decides nothing about the
 * app: whatever the screen does with load/error is the app's real code.
 */
import { act } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

interface ExistsFs {
  exists(path: string): Promise<boolean>;
}

type ImageNode = ReactTestInstance & {
  props: {
    source?: { uri?: string } | Array<{ uri?: string }>;
    onLoad?: (event: unknown) => void;
    onError?: (event: unknown) => void;
  };
};

function sourceUri(node: ImageNode): string | undefined {
  const { source } = node.props;
  const first = Array.isArray(source) ? source[0] : source;
  return typeof first?.uri === 'string' ? first.uri : undefined;
}

/** Fire the native load outcome for every rendered file-backed image. Returns what was decoded. */
export async function decodeRenderedImages(
  root: ReactTestInstance,
  fs: ExistsFs,
): Promise<Array<{ uri: string; loaded: boolean }>> {
  const images = root.findAll(
    node =>
      (node.type as unknown) === 'Image' && !!sourceUri(node as ImageNode),
  ) as ImageNode[];
  const outcomes: Array<{ uri: string; loaded: boolean }> = [];
  for (const image of images) {
    const uri = sourceUri(image)!;
    if (!uri.startsWith('file://')) continue;
    const loaded = await fs.exists(uri.replace(/^file:\/\//, ''));
    outcomes.push({ uri, loaded });
    await act(async () => {
      if (loaded) {
        image.props.onLoad?.({ nativeEvent: { source: { uri } } });
      } else {
        image.props.onError?.({
          nativeEvent: { error: `No such file: ${uri}` },
        });
      }
    });
  }
  return outcomes;
}
