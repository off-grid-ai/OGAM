import type { ReactTestInstance } from 'react-test-renderer';

/**
 * The platform's screen-reader rule, applied to the rendered tree: a host view with
 * `accessible={true}` is ONE accessibility element, so VoiceOver/TalkBack and UI automation see it
 * as a single node and cannot focus anything inside it on its own. RNTL's role queries do not apply
 * this rule, so a test that wants to know whether a person using a screen reader can reach an
 * element checks its ancestors with this.
 *
 * Returns the label (or type) of the first accessible ancestor that swallows `element`, or null when
 * the element is reachable on its own.
 */
export function swallowedByAccessibleAncestor(element: ReactTestInstance): string | null {
  for (let node = element.parent; node; node = node.parent) {
    if (typeof node.type === 'string' && node.props.accessible === true) {
      return String(node.props.accessibilityLabel ?? node.props.testID ?? node.type);
    }
  }
  return null;
}

/**
 * The accessibility element a screen reader lands on for `element`: the outermost `accessible`
 * host that contains it, or the element itself when nothing folds it. Its text content is what the
 * screen reader reads out for that stop.
 */
export function accessibilityElementFor(element: ReactTestInstance): ReactTestInstance {
  let found = element;
  for (let node: ReactTestInstance | null = element; node; node = node.parent) {
    if (typeof node.type === 'string' && node.props.accessible === true) found = node;
  }
  return found;
}
