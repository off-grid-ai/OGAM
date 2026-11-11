/** Runs the study tools the tutor can call (kept out of the main tool dispatcher). */
import { findImages, imagesMarkdown } from './images';
import { studyHelpers } from './helperTool';
import { studyMath, type StudyMathArgs } from './mathTools';
import { scienceData } from './science';

export async function runStudyTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'study_math') return studyMath(args as StudyMathArgs);
  if (name === 'study_helpers') return studyHelpers(args);
  if (name === 'science_data') return scienceData(String(args.action ?? ''), String(args.input ?? ''));
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) throw new Error('Missing required parameter: query');
  return imagesMarkdown(await findImages(query));
}
