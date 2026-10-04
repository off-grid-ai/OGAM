export type ModelKey = string

export const makeModelKey = (modelId: string, fileName: string): ModelKey =>
  `${modelId}/${fileName}`
