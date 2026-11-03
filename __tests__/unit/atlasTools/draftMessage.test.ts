import { messageUrl } from '../../../src/atlasTools/deviceTools';

describe('draft text and email links', () => {
  it('builds a call link with only dialable characters', () => {
    expect(messageUrl('call', '', '+1 (555) 010-2030')).toBe('tel:+15550102030');
  });
  it('builds a text link with the message ready', () => {
    expect(messageUrl('text', 'Running 10 min late, sorry!', '+1 (555) 010-2030')).toBe('sms:+15550102030?body=Running%2010%20min%20late%2C%20sorry!');
  });
  it('builds an email link with subject and body, and works without a recipient', () => {
    expect(messageUrl('email', 'Hi Sam,\nSee you at 3.', 'sam@example.com', 'Meeting')).toBe('mailto:sam@example.com?subject=Meeting&body=Hi%20Sam%2C%0ASee%20you%20at%203.');
    expect(messageUrl('email', 'Hello', '', 'Hi')).toBe('mailto:?subject=Hi&body=Hello');
  });
});
