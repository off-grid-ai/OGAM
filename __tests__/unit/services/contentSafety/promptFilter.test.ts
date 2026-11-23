/**
 * The image prompt filter: a prompt that asks for sexual or nude content never reaches an image model,
 * however it is spelled; an ordinary prompt always passes.
 */
import { checkImagePrompt } from '../../../../src/services/contentSafety/promptFilter';

const blocked = (text: string) => expect(checkImagePrompt(text).allowed).toBe(false);
const allowed = (text: string) => expect(checkImagePrompt(text)).toEqual({ allowed: true });

describe('checkImagePrompt', () => {
  it('passes ordinary prompts', () => {
    allowed('a cat sitting on a windowsill, golden hour');
    allowed('Essex countryside in the rain');
    allowed('a sextant on an old map');
    allowed('portrait of an astronaut, studio lighting, 85mm');
    allowed('');
    allowed(null);
    allowed(undefined);
  });

  it('blocks a listed word in any case', () => {
    blocked('a NUDE woman on the beach');
    blocked('naked man');
    blocked('nsfw anime girl');
  });

  it('names the match for the log', () => {
    expect(checkImagePrompt('topless model')).toEqual({ allowed: false, match: 'topless' });
  });

  it('undoes digit and symbol swaps and separators inside a word', () => {
    blocked('n4ked woman');
    blocked('s3xy pose');
    blocked('p0rn');
    blocked('n.u.d.e');
    blocked('$exy');
  });

  it('removes accents before matching', () => {
    blocked('núde figure');
  });

  it('catches plural and verb endings on a listed word', () => {
    blocked('two dicks');
    blocked('strippers dancing');
  });

  it('blocks phrases whose words are fine alone', () => {
    blocked('a woman with no clothes');
    blocked('see-through dress');
    blocked('full frontal');
    allowed('a woman with new clothes');
  });

  it('matches across punctuation between words', () => {
    blocked('woman,naked,beach');
    blocked('(nude:1.4), masterpiece');
  });
});
