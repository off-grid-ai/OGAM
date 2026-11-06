/**
 * Back from the Model settings screen, as the user presses it.
 *
 * The chat's settings sheet opens Model settings on top of the chat, and a real stack keeps the chat
 * mounted behind it with a Back of its own, so "Back" alone is ambiguous. This presses the Back in the
 * Model settings header: the one whose header also holds the screen's Reset ("Reset to defaults").
 * Nothing is faked: it only finds the real button and presses it.
 */
import type { ReactTestInstance } from 'react-test-renderer';

type Queries = {
  getAllByLabelText: (label: string) => ReactTestInstance[];
};
type Rtl = {
  fireEvent: { press: (node: ReactTestInstance) => void };
  within: (node: ReactTestInstance) => {
    queryAllByLabelText: (label: string) => ReactTestInstance[];
    queryByLabelText: (label: string) => ReactTestInstance | null;
  };
};

export function pressModelSettingsBack(view: Queries, rtl: Rtl): void {
  // Walk up from each Back until the Reset shows, never past a node that holds a second Back.
  const inModelSettingsHeader = (back: ReactTestInstance) => {
    for (let node: ReactTestInstance | null = back; node; node = node.parent) {
      if (rtl.within(node).queryAllByLabelText('Back').length > 1) return false;
      if (rtl.within(node).queryByLabelText('Reset to defaults')) return true;
    }
    return false;
  };
  const backs = view.getAllByLabelText('Back').filter(inModelSettingsHeader);
  if (backs.length !== 1) throw new Error(`Expected one Back in the Model settings header, found ${backs.length}`);
  rtl.fireEvent.press(backs[0]);
}
