import { appLinkTarget } from '../../src/navigation/appLinks';

describe('launcher shortcut links', () => {
  it('knows the four shortcut targets and nothing else', () => {
    expect(appLinkTarget('atlas://app/chat')).toBe('chat');
    expect(appLinkTarget('atlas://app/CALL/')).toBe('call');
    expect(appLinkTarget('atlas://app/record')).toBe('record');
    expect(appLinkTarget('atlas://app/brief')).toBe('brief');
    expect(appLinkTarget('atlas://app/schedule')).toBe('schedule');
    expect(appLinkTarget('atlas://app/delete-everything')).toBeNull();
    expect(appLinkTarget('atlas://sync?id=abc&key=xyz')).toBeNull();
    expect(appLinkTarget('https://example.com/chat')).toBeNull();
    expect(appLinkTarget(null)).toBeNull();
  });
});
