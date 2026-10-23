/** The alert queue's pure rules: queued in order, never added twice, closed by the alert closed. */
import { dismissAlert, enqueueAlert, initialAlertState, shownAlert, showAlert } from '../../../src/utils/alertState';

describe('alert queue', () => {
  it('shows nothing when no alert waits', () => {
    expect(shownAlert([])).toBe(initialAlertState);
  });

  it('shows the first alert raised; a later one waits behind it', () => {
    const ready = showAlert('Model is ready');
    const failed = showAlert('Download Failed', 'Not enough space.');
    const queue = enqueueAlert(enqueueAlert([], ready), failed);
    expect(shownAlert(queue)).toBe(ready);
    expect(shownAlert(dismissAlert(queue, ready))).toBe(failed);
  });

  it('does not queue the same alert twice', () => {
    const queue = enqueueAlert(enqueueAlert([], showAlert('Search Error', 'Try again.')), showAlert('Search Error', 'Try again.'));
    expect(queue).toHaveLength(1);
  });

  it('closing an alert that already closed leaves the next one on screen', () => {
    const first = showAlert('First');
    const second = showAlert('Second');
    const afterOne = dismissAlert(enqueueAlert(enqueueAlert([], first), second), first);
    expect(shownAlert(dismissAlert(afterOne, first))).toBe(second);
  });
});
