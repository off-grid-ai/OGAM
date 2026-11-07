import { memoryShortfallCopy } from '../../../src/services/llmSafetyChecks';

describe('the memory refusal in plain words', () => {
  it('says what the model needs and what is free, in GB, with the ways forward', () => {
    expect(memoryShortfallCopy(7030, 4076, 8192)).toBe(
      'Not enough memory: this model needs about 6.9 GB of memory and 3.9 GB is free. ' +
        'Close other apps, choose a smaller model, or lower the context length (now 8,192).',
    );
  });

  it('never reads as if it fits: the need rounds up and the free amount rounds down', () => {
    const copy = memoryShortfallCopy(1960, 1955, 4096);
    const [, need, free] = /needs about ([\d.]+) GB of memory and ([\d.]+) GB is free/.exec(copy)!;
    expect(Number(need)).toBeGreaterThan(Number(free));
  });
});
