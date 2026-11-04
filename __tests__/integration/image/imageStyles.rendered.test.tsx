/**
 * A picture in a style, Restyle on it, and Retry keeping the turn's style.
 *
 * SPEC (Ali, 2026-11-04; mock approved at the Mobile Styles canvas): in image mode the chat shows the
 * picture styles. A chosen style adds its words to my prompt, my message names it, Retry draws the turn
 * again in that same style, and Restyle on the picture draws my prompt again in the style I pick.
 *
 * The real ChatScreen, router, image service and stores. Device boundary only: the diffusion engine.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.unmock('@react-navigation/native');

const { mediaStyle } = require('@offgrid/models');

/** My message's "•••" › Retry. RNTL's press traversal does not reach this control inside the message
 *  list, so the bound handler is invoked off the node, which is what a tap does. */
async function resendLastUserMessage(h: Awaited<ReturnType<typeof setupChatScreen>>) {
  type PressNode = { props?: Record<string, unknown>; parent?: PressNode | null } | null;
  const press = async (node: unknown) =>
    h.rtl.act(async () => {
      let n = node as PressNode;
      for (let d = 0; n && d < 12; d++) {
        const onPress = n.props?.onPress;
        if (typeof onPress === 'function') return void (onPress as () => void)();
        n = n.parent ?? null;
      }
      throw new Error('no pressable ancestor');
    });
  const view = h.view!;
  const bubbles = view.queryAllByTestId('user-message');
  await press(h.rtl.within(bubbles[bubbles.length - 1]).getByText('•••'));
  await h.rtl.waitFor(() => expect(view.getByTestId('action-menu')).toBeTruthy());
  await press(view.getByTestId('action-retry'));
}
const WATERCOLOR = mediaStyle('image', 'watercolor').words;
const SKETCH = mediaStyle('image', 'sketch').words;

it('a chosen style reaches the image engine; Restyle draws my prompt again in another style', async () => {
  const h = await setupChatScreen({ navigation: 'real', engine: 'litert', platform: 'ios' });
  h.render();
  await h.placeImageModel();
  const view = h.view!;
  await h.cycleImageMode(); // auto → image mode
  h.rtl.fireEvent.press(await view.findByTestId('style-row-watercolor'));
  await h.tapSend('a mountain cabin at dawn');
  await h.rtl.waitFor(() => expect(h.boundary.diffusion.calls.generateImage.length).toBe(1));
  expect(String(h.boundary.diffusion.calls.generateImage[0].prompt)).toContain(`a mountain cabin at dawn, ${WATERCOLOR}`);
  const userMessage = (await view.findAllByTestId('user-message'))[0];
  expect(h.rtl.within(userMessage).getByTestId('message-style').props.children).toBe('Watercolor');

  h.rtl.fireEvent.press(await view.findByTestId('image-restyle', {}, { timeout: 8000 }));
  expect((await view.findByTestId('restyle-row-watercolor')).props.accessibilityState).toMatchObject({ selected: true });
  h.rtl.fireEvent.press(view.getByTestId('restyle-row-sketch'));
  await h.rtl.waitFor(() => expect(h.boundary.diffusion.calls.generateImage.length).toBe(2), { timeout: 8000 });
  expect(String(h.boundary.diffusion.calls.generateImage[1].prompt)).toContain(`a mountain cabin at dawn, ${SKETCH}`);
}, 90_000);

it('Retry draws the turn again in the style it was made in, whatever the chat picks next', async () => {
  const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
  h.render();
  await h.placeImageModel({ backend: 'coreml' });
  const view = h.view!;
  await h.cycleImageMode();
  // Enhance on, as most people run it: its reply is the turn the menu belongs to.
  const { ImageGenerationSection } = require('../../../src/components/GenerationSettingsModal/ImageGenerationSection');
  const s = h.renderAside(h.React.createElement(ImageGenerationSection, {}));
  h.rtl.fireEvent.press(s.getByTestId('modal-image-advanced-toggle'));
  h.rtl.fireEvent.press(await h.rtl.waitFor(() => s.getByTestId('image-enhance-on')));
  s.unmount();
  h.rtl.fireEvent.press(await view.findByTestId('style-row-watercolor'));
  h.boundary.llama!.scriptCompletion({ text: 'a cosy cabin on a ridge at first light' });
  // The drawing parks inside native; X abandons it, so the turn waits to be retried.
  h.boundary.diffusion.holdNextGeneration();
  await h.tapSend('a mountain cabin at dawn');
  await h.rtl.waitFor(() => expect(h.boundary.diffusion.generationHeld()).toBe(true));
  await h.pressImageCardStop();
  await h.settle(200);
  // The chat moves on to another style; the first turn keeps its own.
  await h.cycleImageMode(); // image mode again: the row shows this chat's Watercolor
  h.rtl.fireEvent.press(await view.findByTestId('style-row-sketch'));
  await h.cycleImageMode(); // and off again; the chat now picks Sketch
  h.boundary.llama!.scriptCompletion({ text: 'a cosy cabin on a ridge at first light' });
  await resendLastUserMessage(h);
  await h.rtl.waitFor(() => expect(h.boundary.diffusion.calls.generateImage.length).toBe(2), { timeout: 8000 });
  // Enhance rewrote the words; the turn's own Watercolor still comes last, not the chat's new Sketch.
  const retried = String(h.boundary.diffusion.calls.generateImage[1].prompt);
  expect(retried.endsWith(`, ${WATERCOLOR}`)).toBe(true);
  expect(retried).not.toContain(SKETCH);
}, 90_000);
