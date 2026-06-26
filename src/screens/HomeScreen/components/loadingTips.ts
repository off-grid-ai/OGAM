// Tips shown while a model loads. Loading can take many seconds, so we rotate
// these to give the user something useful to read instead of a bare spinner.
// Copy follows docs/brand_tone_voice.md: proof-first, plain words, no
// exclamation marks, no em dashes.

export type LoadingTip = {
  text: string;
};

export const LOADING_TIPS: readonly LoadingTip[] = [
  {
    text: "Close background apps before loading. Large models need most of your phone's RAM.",
  },
  {
    text: 'Turn on thinking only when accuracy matters. It reasons step by step, so replies take longer.',
  },
  {
    text: 'Raise the temperature toward 1.5-2 for more creative replies. Keep it near 0 for precise answers.',
  },
  {
    text: "The model runs in your phone's RAM. Nothing is sent anywhere.",
  },
  {
    text: 'Bigger models answer better but load slower and use more memory.',
  },
] as const;

export const TIP_ROTATION_MS = 7000;
