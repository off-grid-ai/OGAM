/**
 * Keep the same person in every shot of a film.
 *
 * SPEC (OGAM user's view): on a storyboard I tap "Keep this person in every shot?", name the person,
 * add their photos from my library and confirm the photos are of me or of people who agreed. Keep
 * is off until all three are done. Back on the storyboard the person is named; when the film is made
 * on my computer it carries their photos. I can stop keeping them. On my next film the person I
 * already made is offered with one tap.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the photo library
 * (react-native-image-picker, faked in jest.setup), the RAM sensor and Desktop's gateway at `fetch`.
 */
jest.unmock('@react-navigation/native');

import { closeStudioApp, launchStudioApp, makeClipInChat, type StudioApp } from '../../harness/videoStudioApp';

afterEach(() => closeStudioApp(), 90_000);

/** The photo the library hands back (jest.setup's picker answers file:///mock/image.jpg). */
const LIBRARY_PHOTO = '/mock/image.jpg';

async function storyboard(app: StudioApp): Promise<void> {
  const { view, rtl } = app;
  const chips = view.getAllByTestId('video-make-story');
  rtl.fireEvent.press(chips[chips.length - 1]);
  await view.findByTestId('film-make-real', {}, { timeout: 15_000 });
}

async function makeCharacter(app: StudioApp, name: string): Promise<void> {
  const { view, rtl } = app;
  rtl.fireEvent.press(view.getByTestId('add-character'));
  const save = await view.findByTestId('character-save', {}, { timeout: 10_000 });
  expect(save.props.accessibilityState?.disabled).toBe(true);
  rtl.fireEvent.changeText(view.getByTestId('character-name'), name);
  rtl.fireEvent.press(view.getByTestId('character-add-photos'));
  await view.findByLabelText('Remove photo');
  // A name and a photo are not enough: the consent switch is still off.
  expect(view.getByTestId('character-save').props.accessibilityState?.disabled).toBe(true);
  rtl.fireEvent(view.getByTestId('character-consent'), 'valueChange', true);
  await rtl.waitFor(() => expect(view.getByTestId('character-save').props.accessibilityState?.disabled).toBe(false));
  rtl.fireEvent.press(view.getByTestId('character-save'));
  await view.findByLabelText(`Stop keeping ${name}`, {}, { timeout: 10_000 });
}

it('keeps a named person with their photos in the film sent to the computer, and lets it go', async () => {
  const app = await launchStudioApp();
  const { view, rtl, boundary } = app;
  boundary.fs!.seedFile(LIBRARY_PHOTO, 2048);
  await makeClipInChat(app, 'a girl flying a kite on a windy beach');
  await storyboard(app);

  // A photo removed before saving leaves Keep off again.
  rtl.fireEvent.press(view.getByTestId('add-character'));
  await view.findByTestId('character-save', {}, { timeout: 10_000 });
  rtl.fireEvent.changeText(view.getByTestId('character-name'), 'Mia');
  rtl.fireEvent.press(view.getByTestId('character-add-photos'));
  rtl.fireEvent.press(await view.findByLabelText('Remove photo'));
  await rtl.waitFor(() => expect(view.queryByLabelText('Remove photo')).toBeNull());
  rtl.fireEvent(view.getByTestId('character-consent'), 'valueChange', true);
  expect(view.getByTestId('character-save').props.accessibilityState?.disabled).toBe(true);
  rtl.fireEvent.press(view.getAllByLabelText('Back').pop()!);
  await view.findByTestId('add-character');

  await makeCharacter(app, 'Mia');
  expect(view.queryByTestId('add-character')).toBeNull();
  expect(view.getByText('Mia')).toBeTruthy();

  // The film made on the computer carries Mia and her photo, with her consent.
  app.stories.hold();
  rtl.fireEvent.press(view.getByTestId('film-make-real'));
  await rtl.waitFor(() => expect(app.stories.submissions).toHaveLength(1), { timeout: 10_000 });
  const sent = app.stories.submissions[0] as {
    characters: Array<{ name: string; photos: unknown[]; consentAt?: number }>;
    photos: Record<string, string>;
  };
  expect(sent.characters.map(person => person.name)).toEqual(['Mia']);
  expect(sent.characters[0].photos).toHaveLength(1);
  expect(sent.characters[0].consentAt).toBeGreaterThan(0);
  expect(Object.values(sent.photos)[0]).toMatch(/^data:image\/jpeg;base64,/);

  // Stopped, the film is a draft again and Mia can be let go.
  rtl.fireEvent.press(await view.findByTestId('making-stop', {}, { timeout: 10_000 }));
  await view.findByTestId('making-retry', {}, { timeout: 10_000 });
  rtl.fireEvent.press(view.getAllByLabelText('Back').pop()!);
  rtl.fireEvent.press(await view.findByLabelText('Stop keeping Mia'));
  await view.findByTestId('add-character');
  expect(view.queryByText('Mia')).toBeNull();
}, 90_000);

it('offers the person already made on the next film', async () => {
  const app = await launchStudioApp();
  const { view, rtl, boundary } = app;
  boundary.fs!.seedFile(LIBRARY_PHOTO, 2048);
  await makeClipInChat(app, 'a boy skating down a quiet street');
  await storyboard(app);
  await makeCharacter(app, 'Leo');

  // Back to the chat, and a second film from the same clip.
  rtl.fireEvent.press(view.getAllByLabelText('Back').pop()!);
  await storyboard(app);
  const offer = await view.findByTestId('add-character', {}, { timeout: 10_000 });
  rtl.fireEvent.press(offer);
  const [known] = await view.findAllByTestId(/^character-offer-/, {}, { timeout: 10_000 });
  expect(rtl.within(known).getByText('Leo')).toBeTruthy();
  rtl.fireEvent.press(known);
  await view.findByLabelText('Stop keeping Leo', {}, { timeout: 10_000 });
}, 90_000);

it('deleting a person asks first; Cancel keeps them, Delete removes them', async () => {
  const app = await launchStudioApp();
  const { view, rtl, boundary } = app;
  boundary.fs!.seedFile(LIBRARY_PHOTO, 2048);
  await makeClipInChat(app, 'a boy skipping stones on a lake');
  await storyboard(app);
  await makeCharacter(app, 'Leo');

  // From the storyboard: back Home, the Gallery card, its Videos tab, where the people made so far are listed.
  while (view.queryAllByLabelText('Back').length > 0) rtl.fireEvent.press(view.getAllByLabelText('Back').pop()!);
  rtl.fireEvent.press(await view.findByTestId('home-gallery-card', {}, { timeout: 10_000 }));
  await view.findByTestId('gallery-screen');
  rtl.fireEvent.press(view.getByTestId('gallery-tab-videos'));
  rtl.fireEvent.press(await view.findByLabelText('Character Leo', {}, { timeout: 10_000 }));
  const remove = await view.findByLabelText('Delete character', {}, { timeout: 10_000 });

  expect(app.dialog()).toBeNull();
  rtl.fireEvent.press(remove);
  expect(app.dialog()?.title).toBe('Delete Leo?');
  // Cancel and Delete are the only answers: no header Done beside them.
  expect(view.queryByTestId('app-sheet-close')).toBeNull();
  await app.answer('Cancel');
  expect(view.getByLabelText('Delete character')).toBeTruthy();

  rtl.fireEvent.press(view.getByLabelText('Delete character'));
  await app.answer('Delete');
  await rtl.waitFor(() => expect(view.queryByLabelText('Character Leo')).toBeNull());
  expect(view.queryByLabelText('Delete character')).toBeNull();
}, 90_000);
