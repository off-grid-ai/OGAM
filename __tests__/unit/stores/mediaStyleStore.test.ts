import { adoptDraftStyles, chatStyleId, NEW_CHAT_STYLE_KEY, useMediaStyleStore } from '../../../src/stores/mediaStyleStore';

beforeEach(() => useMediaStyleStore.setState({ byChat: {} }));

it('a style chosen before the chat had an id goes to that chat, and no other chat takes it', () => {
  const { setStyle } = useMediaStyleStore.getState();
  setStyle(NEW_CHAT_STYLE_KEY, 'image', 'watercolor');
  setStyle(NEW_CHAT_STYLE_KEY, 'video', 'cinematic');
  // Another chat with no style of its own does not take the draft.
  expect(chatStyleId('other-chat', 'image')).toBeUndefined();
  // The new chat's first send (text or not) gives it an id: both drafts move to it.
  adoptDraftStyles('new-id');
  expect(chatStyleId('new-id', 'image')).toBe('watercolor');
  expect(chatStyleId('new-id', 'video')).toBe('cinematic');
  expect(useMediaStyleStore.getState().byChat[NEW_CHAT_STYLE_KEY]).toEqual({});
  // The next new chat starts with no style.
  adoptDraftStyles('next-id');
  expect(chatStyleId('next-id', 'image')).toBeUndefined();
});
