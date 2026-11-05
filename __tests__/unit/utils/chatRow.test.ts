/**
 * A chat row's kind and preview (hand test 7: image chats showed no icon, and Home repeated titles).
 */
import { chatKind, rowPreview } from '../../../src/utils/chatRow';

const user = (extra: object = {}) => ({ id: 'u', role: 'user', content: 'x', timestamp: 0, ...extra }) as never;
const reply = (extra: object = {}) => ({ id: 'a', role: 'assistant', content: 'y', timestamp: 0, ...extra }) as never;

describe('chatKind', () => {
  it('reads the last turn the person sent', () => {
    expect(chatKind([user({ turnKind: 'text' }), reply(), user({ turnKind: 'image' }), reply()])).toBe('image');
  });

  it('falls back to a reply that carries a picture or a video, for chats from before turns were stamped', () => {
    expect(chatKind([user(), reply({ attachments: [{ id: 'i', type: 'image', uri: 'file:///a.png' }] })])).toBe('image');
    expect(chatKind([user(), reply({ attachments: [{ id: 'v', type: 'video', uri: 'file:///a.mp4' }] })])).toBe('video');
  });

  it('is a text chat otherwise', () => {
    expect(chatKind([user(), reply()])).toBe('text');
  });
});

describe('rowPreview', () => {
  it('drops a preview that only repeats the title', () => {
    expect(rowPreview('You: [test] Find me one good hiking trail near Pune', '[test] Find me one good hiking trail…')).toBe('');
  });

  it('keeps a preview that says something new', () => {
    expect(rowPreview('Sinhagad Fort is a 2.7 km climb.', '[test] Find me one good hiking trail near Pune')).toBe(
      'Sinhagad Fort is a 2.7 km climb.',
    );
  });
});
