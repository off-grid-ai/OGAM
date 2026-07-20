/** P2 #160 — long prose and unbroken content remain readable in the real chat. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const LONG_TOKEN = 'private-local-context-'.repeat(18);
const REPLY =
  `This paragraph must remain readable at narrow widths. ${LONG_TOKEN} ` +
  'The final sentence must still be visible after the unbroken content.';

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (value && typeof value === 'object' && 'props' in value) {
    return textContent(
      (value as { props?: { children?: unknown } }).props?.children,
    );
  }
  return '';
}

describe('P2 full-App long-text wrapping', () => {
  it('renders the complete response in a bounded multiline assistant bubble', async () => {
    const app = await renderMainApp({ boundary: { llama: true } });
    const { StyleSheet, Text, View } =
      require('react-native') as typeof import('react-native');
    await openChatWithJourneyModel(app.rtl, app.view);
    app.boundary.llama!.scriptCompletion({ text: REPLY });
    sendChatMessage(app.rtl, app.view, 'Return the long wrapping fixture');

    const assistant = await app.rtl.waitFor(
      () => {
        expect(
          app.view.getByText(
            /The final sentence must still be visible after the unbroken content/,
          ),
        ).toBeTruthy();
        const messages = app.view.getAllByTestId('assistant-message');
        return messages[messages.length - 1];
      },
      { timeout: 8000 },
    );
    const assistantView = app.rtl.within(assistant);
    const rendered = assistantView
      .UNSAFE_getAllByType(Text)
      .map(node => textContent(node.props.children))
      .join('');
    expect(rendered).toContain('This paragraph must remain readable');
    expect(rendered).toContain(LONG_TOKEN);
    expect(rendered).toContain(
      'The final sentence must still be visible after the unbroken content.',
    );
    expect(
      assistantView
        .UNSAFE_getAllByType(View)
        .some(node => StyleSheet.flatten(node.props.style)?.maxWidth === '85%'),
    ).toBe(true);
    app.view.unmount();
  }, 30000);
});
