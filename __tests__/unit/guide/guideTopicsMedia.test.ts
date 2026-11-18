/**
 * Every feature the phone's guide shows has a picture. A topic page with only an icon in a grey box
 * reads as unfinished (Mac, 18 Nov 2026). This fails when a topic is added without a MEDIA entry.
 */
import { mobileGuideTopics } from '../../../src/screens/GuideScreen/guideTopics';

it('every guide topic on the phone has a picture', () => {
  expect(mobileGuideTopics().filter(t => !t.media).map(t => t.id)).toEqual([]);
});
