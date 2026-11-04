/**
 * Sampling settings a model's author recommends, used as that model's DEFAULTS. Precedence, strongest first:
 *   1. the active agent's own value (an agent that sets a temperature means it),
 *   2. a value the person changed in Settings (anything that differs from the app's own default),
 *   3. the model's recommended value,
 *   4. the app's default.
 * Top-k and min-p have no setting or agent field, so they come from the model's recommendation, else the app's fixed top-k of 40.
 * A person who sets Settings back to exactly the app's default gets the model's recommendation again; to pin a value for one model
 * use an agent.
 */
export interface Sampling { temperature: number; topK: number; topP: number; minP?: number; repeatPenalty: number }

/** The app's own defaults for the settings that exist (kept equal to the store's defaults by a test). */
export const APP_SAMPLING: Sampling = { temperature: 0.7, topK: 40, topP: 0.9, repeatPenalty: 1.1 };

/** Recommended by the author, from the model page (HauhauCS Gemma 4 12B: "dialed in specifically for this build"). */
const MODEL_SAMPLING: Array<{ match: RegExp; sampling: Sampling }> = [
  { match: /gemma-?4.*hauhau|hauhau.*gemma-?4/i, sampling: { temperature: 0.6, topK: 64, topP: 0.9, minP: 0.05, repeatPenalty: 1.1 } },
];

/** What the completion used when neither Settings nor an agent gave a value (unchanged from before model defaults existed). */
const FALLBACK = { temperature: 0.7, topP: 0.95, repeatPenalty: 1.1 };

export const samplingDefaultsFor = (modelPath: string | null | undefined): Sampling | null =>
  (modelPath ? MODEL_SAMPLING.find((m) => m.match.test(modelPath.split('/').pop() ?? modelPath))?.sampling ?? null : null);

export function resolveSampling(input: {
  agent: { temperature?: number; topP?: number; repeatPenalty?: number };
  user: { temperature?: number; topP?: number; repeatPenalty?: number };
  model: Sampling | null;
}): Sampling {
  const { agent, user, model } = input;
  type Layers = { agent?: number; user?: number; appDefault: number; model?: number; fallback: number };
  const choose = (l: Layers): number => l.agent ?? (l.user !== undefined && l.user !== l.appDefault ? l.user : (l.model ?? l.user ?? l.fallback));
  return {
    temperature: choose({ agent: agent.temperature, user: user.temperature, appDefault: APP_SAMPLING.temperature, model: model?.temperature, fallback: FALLBACK.temperature }),
    topP: choose({ agent: agent.topP, user: user.topP, appDefault: APP_SAMPLING.topP, model: model?.topP, fallback: FALLBACK.topP }),
    repeatPenalty: choose({ agent: agent.repeatPenalty, user: user.repeatPenalty, appDefault: APP_SAMPLING.repeatPenalty, model: model?.repeatPenalty, fallback: FALLBACK.repeatPenalty }),
    topK: model?.topK ?? APP_SAMPLING.topK,
    ...(model?.minP != null ? { minP: model.minP } : {}),
  };
}
