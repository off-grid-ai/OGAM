import React from 'react';
import { render } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { MarkdownText } from '../../../src/components/MarkdownText';

describe('wide content stays inside the chat', () => {
  it('scrolls a code block sideways', () => {
    const view = render(<MarkdownText>{'```js\nconst aVeryLongLine = someFunction(argumentOne, argumentTwo, argumentThree, argumentFour);\n```'}</MarkdownText>);
    expect(view.UNSAFE_getAllByType(ScrollView).some((s) => s.props.horizontal)).toBe(true);
  });
  it('scrolls a wide table sideways', () => {
    const view = render(<MarkdownText>{'| a | b | c | d | e | f |\n|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 |'}</MarkdownText>);
    expect(view.UNSAFE_getAllByType(ScrollView).some((s) => s.props.horizontal)).toBe(true);
  });
});
