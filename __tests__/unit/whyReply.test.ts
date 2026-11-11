import { whyThisReply } from '../../src/study/whyReply';

it('says what a reply was written from, line by line', () => {
  expect(whyThisReply({ gpu: false, modelName: 'Gemma 4', lessonsUsed: ['General', 'Tax'], sources: [{ title: 'Guide (part 1)', quote: 'abc' }], routedToolNames: ['web_search'], truncated: true } as any))
    .toBe('Model: Gemma 4\nLessons used: General and Tax\nDocument excerpts:\n1. Guide (part 1): "abc"\nTools it could use: web_search\nThe reply was cut off at the length limit.');
});
it('gives nothing when nothing was recorded', () => { expect(whyThisReply(undefined)).toBe(''); expect(whyThisReply({ gpu: false } as any)).toBe(''); });
