/** P2 #162/#163 and APP-P2-011 — Settings routes reach their real screens. */
import { renderMainApp } from '../../harness/appJourney';

const destinations = [
  ['Model Settings', 'testID', 'system-prompt-accordion'],
  ['Experimental Features', 'testID', 'experimental-mtp-toggle'],
  ['Remote Servers', 'text', 'No Remote Servers'],
  ['Security', 'text', 'App Lock'],
  ['Device Information', 'text', 'Hardware'],
  ['Storage', 'text', 'Storage Usage'],
  ['Off Grid AI PRO', 'text', 'Pro Active'],
  ['About', 'text', 'Open Source'],
] as const;

describe('P2 Settings navigation journeys', () => {
  it('opens every destination from the real Settings screen', async () => {
    const { rtl, view } = await renderMainApp();
    rtl.fireEvent.press(view.getByTestId('settings-tab'));

    for (const [cardLabel, evidenceKind, evidence] of destinations) {
      rtl.fireEvent.press(await rtl.waitFor(() => view.getByText(cardLabel)));

      await rtl.waitFor(() => {
        const destination =
          evidenceKind === 'testID'
            ? view.getByTestId(evidence)
            : view.getByText(evidence);
        expect(destination).toBeTruthy();
      });

      const back =
        cardLabel === 'Remote Servers'
          ? view.getByTestId('remote-servers-back-button')
          : cardLabel === 'Off Grid AI PRO'
          ? view.getByTestId('pro-detail-back-button')
          : view
              .UNSAFE_getAllByProps({ name: 'arrow-left' })
              .find(icon => icon.props.name === 'arrow-left')?.parent;
      if (!back) throw new Error(`${cardLabel} has no back control`);
      rtl.fireEvent.press(back);
      await rtl.waitFor(() => {
        expect(view.getAllByText('Settings').length).toBeGreaterThan(0);
        expect(
          view.getByTestId('settings-tab').props.accessibilityState,
        ).toEqual(expect.objectContaining({ selected: true }));
        if (cardLabel === 'Off Grid AI PRO') {
          expect(view.queryByTestId('pro-detail-back-button')).toBeNull();
        } else {
          const destination =
            evidenceKind === 'testID'
              ? view.queryByTestId(evidence)
              : view.queryByText(evidence);
          expect(destination).toBeNull();
        }
      });
    }

    view.unmount();
  }, 30000);
});
