import { useEffect, useState } from 'react';
import { speakInAndWait, stop } from '../atlasVoice/tts';
import type { Listening } from './listening';
import { slotForText, speakerSlots, voiceForSlot } from './voices';

/**
 * Plays the parts of a story or podcast. In a dialogue each speaker has their own voice. A podcast plays each part by
 * itself as it appears (it is for listening); a story waits for the speaker button.
 */
export function useListeningAudio({ piece, code, part, done, autoPlay }: { piece: Listening | null; code: string; part: number; done: boolean; autoPlay: boolean }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => stop(), []);

  const playPart = async (index: number) => {
    if (!piece) return;
    stop();
    setPlaying(true);
    const slotOf = speakerSlots(piece.parts.flatMap((p) => p.lines.map((l) => l.speaker)));
    for (const l of piece.parts[index].lines) {
      const voice = await voiceForSlot(code, l.speaker ? slotOf(l.speaker) : slotForText(piece.title));
      if (!(await speakInAndWait(l.t, code, { messageId: 'listening', voice }))) break;
    }
    setPlaying(false);
  };
  const halt = () => { stop(); setPlaying(false); };
  const toggle = () => { if (playing) halt(); else playPart(part); };
  useEffect(() => { if (autoPlay && piece && !done) playPart(part); }, [piece, part]); // eslint-disable-line react-hooks/exhaustive-deps
  return { playing, toggle, halt };
}
