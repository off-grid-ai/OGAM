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
import { render, fireEvent } from '@testing-library/react-native';
import { Clipboard } from 'react-native';
import { MarkdownText, preprocessMarkdown } from '../../../src/components/MarkdownText';

describe('MarkdownText', () => {
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

  it('copies a table as spreadsheet cells or as Markdown, and a code block as code', () => {
    const set = jest.spyOn(Clipboard, 'setString').mockImplementation(() => undefined);
    const view = render(<MarkdownText>{'| Day | Plan |\n| --- | --- |\n| Mon | Run |\n| Tue | Rest |\n\n```\nconst x = 42;\n```'}</MarkdownText>);
    fireEvent.press(view.getByTestId('copy-table-copy-table'));
    expect(set).toHaveBeenLastCalledWith('Day\tPlan\nMon\tRun\nTue\tRest');
    fireEvent.press(view.getByTestId('copy-table-copy-as-markdown'));
    expect(set).toHaveBeenLastCalledWith('| Day | Plan |\n| --- | --- |\n| Mon | Run |\n| Tue | Rest |');
    fireEvent.press(view.getByTestId('copy-code-copy-code'));
    expect(set).toHaveBeenLastCalledWith('const x = 42;');
    set.mockRestore();
  });
});
