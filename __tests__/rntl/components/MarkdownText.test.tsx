/**
 * MarkdownText Component Tests
 *
 * Tests for the themed markdown renderer covering:
 * - Rendering markdown elements (bold, italic, headers, code, lists, blockquotes)
 * - dimmed prop changes the text color to secondary
 * - Empty and plain text content
 * - Asterisk-as-multiplication escaping
 * - Link rendering
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { MarkdownText, dropDanglingBold, preprocessMarkdown } from '../../../src/components/MarkdownText';

describe('MarkdownText', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders plain text', () => {
    const { getByText } = render(<MarkdownText>Hello world</MarkdownText>);
    expect(getByText(/Hello world/)).toBeTruthy();
  });

  it('renders bold text', () => {
    const { getByText } = render(<MarkdownText>{'**bold content**'}</MarkdownText>);
    expect(getByText(/bold content/)).toBeTruthy();
  });

  it('renders italic text', () => {
    const { getByText } = render(<MarkdownText>{'*italic content*'}</MarkdownText>);
    expect(getByText(/italic content/)).toBeTruthy();
  });

  it('renders inline code', () => {
    const { getByText } = render(<MarkdownText>{'Use `myFunction()` here'}</MarkdownText>);
    expect(getByText(/myFunction/)).toBeTruthy();
  });

  it('renders fenced code block', () => {
    const { getByText } = render(
      <MarkdownText>{'```\nconst x = 42;\n```'}</MarkdownText>
    );
    expect(getByText(/const x = 42/)).toBeTruthy();
  });

  it('renders heading', () => {
    const { getByText } = render(<MarkdownText>{'# Section Title'}</MarkdownText>);
    expect(getByText(/Section Title/)).toBeTruthy();
  });

  it('renders unordered list items', () => {
    const { getByText } = render(
      <MarkdownText>{'- Alpha\n- Beta\n- Gamma'}</MarkdownText>
    );
    expect(getByText(/Alpha/)).toBeTruthy();
    expect(getByText(/Beta/)).toBeTruthy();
    expect(getByText(/Gamma/)).toBeTruthy();
  });

  it('renders ordered list items', () => {
    const { getByText } = render(
      <MarkdownText>{'1. First\n2. Second\n3. Third'}</MarkdownText>
    );
    expect(getByText(/First/)).toBeTruthy();
    expect(getByText(/Second/)).toBeTruthy();
    expect(getByText(/Third/)).toBeTruthy();
  });

  it('renders blockquote', () => {
    const { getByText } = render(
      <MarkdownText>{'> Quoted text here'}</MarkdownText>
    );
    expect(getByText(/Quoted text here/)).toBeTruthy();
  });

  it('renders with dimmed prop without crashing', () => {
    const { getByText } = render(
      <MarkdownText dimmed>{'Some dimmed content'}</MarkdownText>
    );
    expect(getByText(/Some dimmed content/)).toBeTruthy();
  });

  it('renders empty string without crashing', () => {
    const { toJSON } = render(<MarkdownText>{''}</MarkdownText>);
    expect(toJSON()).toBeTruthy();
  });

  it('renders multiple paragraphs as separate nodes', () => {
    const { getByText } = render(
      <MarkdownText>{'Paragraph one\n\nParagraph two'}</MarkdownText>
    );
    expect(getByText(/Paragraph one/)).toBeTruthy();
    expect(getByText(/Paragraph two/)).toBeTruthy();
  });

  it('renders multiplication expression without italic formatting', () => {
    const { getByText } = render(
      <MarkdownText>{'Result: 5*5*5*5*6*7'}</MarkdownText>
    );
    // The literal text with asterisks should appear (escaped, not rendered as emphasis)
    expect(getByText(/5\*5\*5\*5\*6\*7/)).toBeTruthy();
  });

  it('preserves intentional markdown emphasis', () => {
    const { getByText } = render(
      <MarkdownText>{'This is *important* text'}</MarkdownText>
    );
    expect(getByText(/important/)).toBeTruthy();
  });

  it('renders long URLs without crashing', () => {
    const longUrl =
      '[Link](https://example.com/very/long/path/that/might/overflow/the/container/width/in/a/chat/bubble)';
    const { toJSON } = render(<MarkdownText>{longUrl}</MarkdownText>);
    expect(toJSON()).toBeTruthy();
  });

  it('opens a Markdown link and refuses an unsafe destination', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const rendered = render(
      <MarkdownText>{'[Docs](https://example.com/docs) [Unsafe](ftp://example.com/file)'}</MarkdownText>,
    );

    fireEvent.press(rendered.getByText('Docs'));
    fireEvent.press(rendered.getByText('Unsafe'));
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith('https://example.com/docs');
    expect(rendered.getAllByRole('link')).toHaveLength(2);
  });

  it('turns a plain web address into a safe clickable link', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const rendered = render(
      <MarkdownText>{'Main page: https://github.com/off-grid-ai'}</MarkdownText>,
    );

    fireEvent.press(rendered.getByRole('link'));
    expect(openURL).toHaveBeenCalledWith('https://github.com/off-grid-ai');
  });
});

describe('preprocessMarkdown', () => {
  it('escapes digit*digit patterns', () => {
    expect(preprocessMarkdown('5*5')).toBe(String.raw`5\*5`);
  });

  it('escapes chained multiplication', () => {
    expect(preprocessMarkdown('5*5*5*5*6*7')).toBe(String.raw`5\*5\*5\*5\*6\*7`);
  });

  it('does not escape word emphasis', () => {
    expect(preprocessMarkdown('*italic*')).toBe('*italic*');
  });

  it('does not escape bold markers', () => {
    expect(preprocessMarkdown('**bold**')).toBe('**bold**');
  });

  it('handles mixed content', () => {
    expect(preprocessMarkdown('The result of 3*4 is *twelve*')).toBe(
      String.raw`The result of 3\*4 is *twelve*`
    );
  });
});

describe('dropDanglingBold (a reply cut off mid-bold)', () => {
  it('drops an unclosed bold marker', () => {
    expect(dropDanglingBold('1. **Ganges**\n2. **Yamuna')).toBe('1. **Ganges**\n2. Yamuna');
  });
  it('keeps closed bold as it is', () => {
    expect(dropDanglingBold('**Ganges** and **Yamuna**')).toBe('**Ganges** and **Yamuna**');
  });
  it('keeps text with no bold', () => {
    expect(dropDanglingBold('No markers here.')).toBe('No markers here.');
  });
  it('renders without raw asterisks', () => {
    const view = render(<MarkdownText>{'2. **Yamuna'}</MarkdownText>);
    expect(view.queryByText(/\*\*/)).toBeNull();
    expect(view.getByText(/Yamuna/)).toBeTruthy();
  });
});

describe('plainMathSpans (maths in an answer reads as text, hand test 22)', () => {
  const { plainMathSpans } = jest.requireActual('../../../src/components/MarkdownText');
  it('turns LaTeX spans into plain symbols', () => {
    expect(plainMathSpans('Working: $$37 \\times 43 = ?$$')).toBe('Working: 37 × 43 = ?');
    expect(plainMathSpans('So $30 \\times 43 = 1290$ and')).toBe('So 30 × 43 = 1290 and');
  });
  it('leaves prices alone', () => {
    expect(plainMathSpans('It costs $5 or $10 a month')).toBe('It costs $5 or $10 a month');
  });
});
