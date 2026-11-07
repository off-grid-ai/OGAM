/**
 * The Gallery's own routes for a test that renders the Gallery: a tapped image opens full screen on the
 * GalleryImage route, a video on GalleryVideo. The screens are the app's own; the image's actions sit in
 * its sheet, opened by More, as a person reaches them.
 */
import React from 'react';
import { withNavigatorRoutes } from './realNavigation';

type View = { getByTestId(id: string): any; getByLabelText(label: string): any; findByText(text: string): Promise<any> };
type RTL = { fireEvent: any; act(fn: () => Promise<void>): Promise<void>; within(el: any): any };

/** The real Gallery routes a Gallery test pushes: one image and one video, full screen. */
export function galleryScreens(): Record<string, React.ComponentType<any>> {
  const { GalleryImageScreen } = require('../../src/screens/GalleryScreen/GalleryImageScreen');
  const { GalleryVideoScreen } = require('../../src/screens/GalleryScreen/GalleryVideoScreen');
  return { GalleryImage: GalleryImageScreen, GalleryVideo: GalleryVideoScreen };
}

/** The real Gallery in a real stack with its image and video routes (the test file unmocks navigation). */
export function galleryWithRoutes(params?: Record<string, unknown>): React.ReactElement {
  const { GalleryScreen } = require('../../src/screens/GalleryScreen');
  return withNavigatorRoutes(React.createElement(GalleryScreen), { params, screens: galleryScreens() });
}

/** Opens the image's sheet with More and presses one of its actions (Save, Delete). */
export async function pressImageAction(rtl: RTL, view: View, action: 'Save' | 'Delete'): Promise<void> {
  rtl.fireEvent.press(view.getByTestId('gallery-image-more'));
  await view.findByText('PROMPT');
  await rtl.act(async () => { rtl.fireEvent.press(view.getByLabelText(action)); });
}

/** Delete from the open image's sheet, then Delete in the confirmation. */
export async function deleteOpenImage(rtl: RTL, view: View): Promise<void> {
  await pressImageAction(rtl, view, 'Delete');
  await view.findByText('Delete Image');
  await rtl.act(async () => {
    rtl.fireEvent.press(rtl.within(view.getByTestId('app-alert')).getByLabelText('Delete'));
  });
}
