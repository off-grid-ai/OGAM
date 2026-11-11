/** Sending a course to another phone as a file, and opening one that was sent. The phone's own save and file pickers do the moving. */
import RNFS from 'react-native-fs';
import { pick, types } from '@react-native-documents/picker';
import { resolvePickedFileUri } from '../utils/resolvePickedFileUri';
import { safeFileName, saveText } from '../study/exportFiles';
import { COURSE_FILE_EXTENSION, courseToFile, parseCourseFile } from './shareCourse';
import { useTopics, type Course } from './store';

/** Saves the course as a file; resolves to where it went, or null when the person closes the save dialog. */
export const shareCourseFile = (course: Course): Promise<string | null> =>
  saveText(safeFileName(course.title, COURSE_FILE_EXTENSION), courseToFile(course));

/** Opens the file picker and adds the chosen course; resolves to its id, or null when the picker is closed. Throws a readable message for a file that is not a course. */
export async function importCourseFile(projectId?: string): Promise<string | null> {
  let files;
  try { files = await pick({ mode: 'open', type: [types.allFiles], allowMultiSelection: false }); } catch { return null; }
  const file = files?.[0];
  if (!file) return null;
  const local = (await resolvePickedFileUri(file.uri, file.name || 'course.json')).replace(/^file:\/\//, '');
  const shared = parseCourseFile(await RNFS.readFile(local, 'utf8'));
  return useTopics.getState().addShared(shared, projectId);
}
