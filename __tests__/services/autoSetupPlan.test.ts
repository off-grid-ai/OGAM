import {
  selectAutoSetupPlans,
  type AutoSetupCompatibleCatalog,
} from '../../src/services/autoSetupPlan';

const candidate = (
  kind: 'text' | 'image' | 'stt',
  name: string,
  sizeBytes: number,
  fitScore: number,
  parameterCountB?: number,
  pick?: 'fast' | 'balanced' | 'best',
) => ({
  id: `${kind}-${name}`,
  name,
  kind,
  sizeBytes,
  fitScore,
  parameterCountB,
  pick,
  payload:
    kind === 'text'
      ? {
          modelId: name,
          file: {
            name: `${name}.gguf`,
            size: sizeBytes,
            quantization: 'Q4_K_M',
            downloadUrl: 'https://boundary.test/text',
          },
        }
      : kind === 'image'
      ? {
          id: `${kind}-${name}`,
          name,
          description: name,
          size: sizeBytes,
          downloadUrl: 'https://boundary.test/image',
          style: 'general',
          backend: 'mnn',
        }
      : { modelId: `${kind}-${name}` },
});

test('Lean, Balanced, and Extreme select only from the compatible device catalog', () => {
  const catalog = {
    text: [
      candidate('text', 'small', 100, 4, 2, 'fast'),
      candidate('text', 'fit', 200, 0, 4, 'balanced'),
      candidate('text', 'large', 300, 2, 9, 'best'),
    ],
    image: [
      candidate('image', 'small', 10, 4),
      candidate('image', 'fit', 20, 0),
      candidate('image', 'large', 30, 2),
    ],
    stt: [
      candidate('stt', 'small', 1, 4),
      candidate('stt', 'fit', 2, 0),
      candidate('stt', 'large', 3, 2),
    ],
  } as AutoSetupCompatibleCatalog;

  const plans = selectAutoSetupPlans(catalog);
  expect(
    plans.map(plan => [plan.tier, ...plan.items.map(item => item.name)]),
  ).toEqual([
    ['lean', 'small', 'small', 'small'],
    ['balanced', 'fit', 'fit', 'fit'],
    ['extreme', 'large', 'large', 'large'],
  ]);
  expect(plans[1].totalBytes).toBe(222);
});

test("text plans are the phone's Fast, Balanced and Best picks, not file-size order", () => {
  const catalog = {
    text: [
      candidate('text', 'Qwen 0.8B', 80, 0, 0.8),
      candidate('text', 'Qwen 9B', 500, 3, 9, 'best'),
      candidate('text', 'Gemma 4B', 900, 2, 4, 'balanced'),
      candidate('text', 'Gemma 2B', 700, 1, 2, 'fast'),
    ],
    image: [candidate('image', 'image', 10, 0)],
    stt: [candidate('stt', 'speech', 1, 0)],
  } as AutoSetupCompatibleCatalog;

  const plans = selectAutoSetupPlans(catalog);
  expect(plans.map(plan => plan.items[0].name)).toEqual([
    'Gemma 2B',
    'Gemma 4B',
    'Qwen 9B',
  ]);
});

test('no plan is forced when one compatible model kind is absent', () => {
  const catalog = {
    text: [candidate('text', 'fit', 2, 0)],
    image: [],
    stt: [candidate('stt', 'fit', 1, 0)],
  } as AutoSetupCompatibleCatalog;
  expect(selectAutoSetupPlans(catalog)).toEqual([]);
});

test('plan selection does not change candidate order', () => {
  const catalog = {
    text: [
      candidate('text', 'large', 300, 2, 9),
      candidate('text', 'small', 100, 4, 2),
    ],
    image: [
      candidate('image', 'large', 30, 2),
      candidate('image', 'small', 10, 4),
    ],
    stt: [candidate('stt', 'large', 3, 2), candidate('stt', 'small', 1, 4)],
  } as AutoSetupCompatibleCatalog;
  const originalOrder = {
    text: catalog.text.map(item => item.id),
    image: catalog.image.map(item => item.id),
    stt: catalog.stt.map(item => item.id),
  };

  selectAutoSetupPlans(catalog);

  expect(catalog.text.map(item => item.id)).toEqual(originalOrder.text);
  expect(catalog.image.map(item => item.id)).toEqual(originalOrder.image);
  expect(catalog.stt.map(item => item.id)).toEqual(originalOrder.stt);
});
