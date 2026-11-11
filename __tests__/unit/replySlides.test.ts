import { slidesFromReply } from '../../src/presentations/replySlides';

const REPLY = `# Saving for a house

Start by knowing your budget. Then pick a target date.

## Step 1: Budget
- Track income
- Track spending
1. Cut one subscription

## Costs
| Item | Cost |
| --- | --- |
| Deposit | 20% |
| Fees | 3% |
`;

describe('slides from a chat reply', () => {
  const { name, slides } = slidesFromReply(REPLY, 'Chat title');
  it('uses the first heading as the deck title and starts and ends with title and closing slides', () => {
    expect(name).toBe('Saving for a house');
    expect(slides[0]).toMatchObject({ layout: 'title', title: 'Saving for a house' });
    expect(slides[slides.length - 1].layout).toBe('closing');
  });
  it('makes one slide per heading with bullets from lists, sentences and table rows', () => {
    const budget = slides.find((s) => s.title === 'Step 1: Budget');
    expect(budget?.bullets).toEqual(['Track income', 'Track spending', 'Cut one subscription']);
    expect(slides.find((s) => s.title === 'Costs')?.bullets).toEqual(['Item: Cost', 'Deposit: 20%', 'Fees: 3%']);
    expect(slides[1].bullets).toEqual(['Start by knowing your budget.', 'Then pick a target date.']);
  });
  it('splits a long block over several slides, and falls back to the chat title', () => {
    const long = slidesFromReply(Array.from({ length: 14 }, (_, i) => `- point ${i + 1}`).join('\n'), 'Chat title');
    expect(long.name).toBe('Chat title');
    const content = long.slides.filter((s) => s.layout === 'bullets');
    expect(content).toHaveLength(3);
    expect(content[1].subtitle).toBe('continued');
  });
});
