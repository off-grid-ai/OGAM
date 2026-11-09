import { MESSAGE_LOOKS, messageLookStyle, isDarkColor, isMessageLook } from '../../src/theme/messageLooks';
import { CHAT_LAYOUTS } from '../../src/theme/appearance';

describe('messaging-app chat looks', () => {
  it('are offered as chat layouts next to Clean and Bubbles', () => {
    const ids = CHAT_LAYOUTS.map((l) => l.id);
    expect(ids.slice(0, 2)).toEqual(['clean', 'bubbles']);
    for (const l of MESSAGE_LOOKS) expect(ids).toContain(l.id);
    expect(isMessageLook('clean')).toBe(false);
    expect(isMessageLook('imessage')).toBe(true);
  });
  it('knows a dark screen from a light one', () => {
    expect(isDarkColor('#000000')).toBe(true);
    expect(isDarkColor('#101418')).toBe(true);
    expect(isDarkColor('#FFFFFF')).toBe(false);
    expect(isDarkColor('#fff')).toBe(false);
    expect(isDarkColor(undefined)).toBe(false);
  });
  it('iMessage: blue for you, grey for the reply, squarer corner by the sender', () => {
    const me = messageLookStyle('imessage', true, false);
    const them = messageLookStyle('imessage', false, false);
    expect(me.bubble.backgroundColor).toBe('#0B84FF');
    expect(me.textColor).toBe('#FFFFFF');
    expect(me.bubble.borderBottomRightRadius).toBeLessThan(me.bubble.borderRadius as number);
    expect(them.bubble.backgroundColor).toBe('#E9E9EB');
    expect(them.bubble.borderBottomLeftRadius).toBeLessThan(them.bubble.borderRadius as number);
  });
  it('changes the reply colour on a dark screen and keeps the text readable', () => {
    const them = messageLookStyle('whatsapp', false, true);
    expect(them.bubble.backgroundColor).toBe('#202C33');
    expect(them.textColor).toBe('#E9EDEF');
  });
  it('Discord: no bubble for you, a row for the reply, a name above each', () => {
    expect(messageLookStyle('discord', true, false).label).toBe('You');
    expect(messageLookStyle('discord', false, false).label).toBe('Assistant');
    expect(messageLookStyle('discord', true, false).bubble.backgroundColor).toBe('transparent');
  });
  it('every look has enough contrast: text is light on dark bubbles, dark on light ones', () => {
    for (const l of MESSAGE_LOOKS) for (const user of [true, false]) for (const dark of [true, false]) {
      const s = messageLookStyle(l.id, user, dark);
      const bg = String(s.bubble.backgroundColor);
      if (bg === 'transparent') continue;
      expect(isDarkColor(s.textColor)).toBe(!isDarkColor(bg));
    }
  });
});
