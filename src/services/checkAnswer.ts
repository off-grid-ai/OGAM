/**
 * "Check this answer": the model is asked to check its own reply claim by claim, and told which figures in it appear nowhere
 * else in the chat (a number with no source in sight is where invented answers usually hide). The figure test runs in code, not
 * by asking the model. Pure, so it is tested without a device.
 */
const NUMBER = /\b\d[\d,]*(?:\.\d+)?%?/g;

const normalize = (s: string) => s.replace(/(\d),(?=\d{3}\b)/g, '$1');

/** Numbers in the reply (two or more digits, or with a decimal point or percent) that appear in none of the earlier messages. */
export function figuresNotInContext(reply: string, context: string[]): string[] {
  const seen = normalize(context.join('\n'));
  const out: string[] = [];
  for (const raw of reply.match(NUMBER) ?? []) {
    const figure = normalize(raw);
    const significant = figure.replace(/[^\d]/g, '').length >= 2 || /[.%]/.test(figure);
    if (!significant || seen.includes(figure) || out.includes(raw)) continue;
    out.push(raw);
  }
  return out.slice(0, 8);
}

/** The message sent for a check. */
export function checkAnswerPrompt(reply: string, context: string[]): string {
  const loose = figuresNotInContext(reply, context);
  return [
    'Check your last answer. Go through it claim by claim and mark each one KNOWN (well established or from the text above), LIKELY, or GUESS.',
    loose.length
      ? `These figures in it appear nowhere else in this chat: ${loose.join(', ')}. For each, say where it comes from, or take it back.`
      : 'Every figure in it also appears earlier in this chat.',
    'Never make up a name, number, quote, link or source. If a claim is a guess, say so. Then give a corrected answer that keeps only what you can support.',
  ].join('\n');
}
