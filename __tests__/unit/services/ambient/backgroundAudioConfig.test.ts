/**
 * Contract guard: the 24/7 ambient recorder can only keep capturing while the app is backgrounded
 * or the screen is locked if iOS grants the `audio` background mode. If a future Info.plist regen
 * drops it, recording would silently stop the moment the app leaves the foreground — the worst kind
 * of regression (no crash, no error, just missing hours). Asserted by reading the source of truth.
 */

import fs from 'fs';
import path from 'path';

const INFO_PLIST = path.resolve(__dirname, '../../../../ios/OffgridMobile/Info.plist');

describe('iOS background-audio config', () => {
  it('declares the `audio` UIBackgroundMode so ambient capture survives backgrounding', () => {
    const plist = fs.readFileSync(INFO_PLIST, 'utf8');
    const block = plist.match(/<key>UIBackgroundModes<\/key>\s*<array>([\s\S]*?)<\/array>/);
    expect(block).not.toBeNull();
    expect(block![1]).toContain('<string>audio</string>');
  });
});
