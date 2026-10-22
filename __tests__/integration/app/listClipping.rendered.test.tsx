/**
 * Android Fabric crash guard (Play Vitals: NPE on View.mViewFlags in ViewGroup.dispatchDraw,
 * IndexOutOfBounds in ReactClippingViewManager.addView).
 *
 * FlatList turns removeClippedSubviews ON by default on Android, and Fabric's clipping detaches
 * rows out of step with the native child index. Every list spreads LIST_CLIPPING_PROPS, so the
 * native scroll view a real screen renders must never clip on Android, and still clips on iOS.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

type Platform = 'android' | 'ios';

function renderedClipping(platform: Platform): unknown[] {
  installNativeBoundary({ fs: true, download: true, ram: { platform, totalBytes: 12 * GB, availBytes: 8 * GB } });
  const React = require('react');
  const { render } = requireRTL();
  const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');

  const screen = render(React.createElement(DownloadManagerScreen));
  // The host scroll views the native side receives: the prop value Fabric acts on.
  return screen.UNSAFE_root
    .findAll((node: any) => typeof node.type === 'string' && 'removeClippedSubviews' in node.props)
    .map((node: any) => node.props.removeClippedSubviews);
}

describe('list clipping', () => {
  it('never clips subviews on Android', () => {
    const values = renderedClipping('android');
    expect(values.length).toBeGreaterThan(0);
    expect(values.every(v => v === false)).toBe(true);
  });

  it('keeps clipping subviews on iOS', () => {
    const values = renderedClipping('ios');
    expect(values.length).toBeGreaterThan(0);
    expect(values.every(v => v === true)).toBe(true);
  });
});

describe('list clipping lint guard', () => {
  // A new list that forgets the shared props fails lint, so it cannot ship the crash.
  const { ESLint } = require('eslint');
  const eslint = new ESLint({ cwd: require('node:path').resolve(__dirname, '../../..') });
  const ruleHits = async (code: string) => {
    const [result] = await eslint.lintText(code, { filePath: 'src/screens/NewListScreen.tsx' });
    return result.messages.filter((m: { ruleId: string | null }) => m.ruleId === 'no-restricted-syntax');
  };
  const header = [
    "import React from 'react';",
    "import { FlatList, SectionList } from 'react-native';",
    "import { LIST_CLIPPING_PROPS } from '../constants/listClipping';",
  ].join('\n');

  it('rejects a list without the shared clipping props', async () => {
    const hits = await ruleHits(`${header}\nexport const A = () => (\n  <><FlatList data={[]} renderItem={() => null} /><SectionList sections={[]} /></>\n);\nvoid LIST_CLIPPING_PROPS;\n`);
    expect(hits).toHaveLength(2);
  }, 60000);

  it('accepts a list that spreads the shared clipping props', async () => {
    const hits = await ruleHits(`${header}\nexport const A = () => (\n  <><FlatList {...LIST_CLIPPING_PROPS} data={[]} renderItem={() => null} /><SectionList {...LIST_CLIPPING_PROPS} sections={[]} /></>\n);\n`);
    expect(hits).toHaveLength(0);
  }, 60000);
});
