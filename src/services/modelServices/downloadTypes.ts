export type ModelDownloadStartRequest =
  | {
      modelType: 'text';
      modelId: string;
      file: import('../../types').ModelFile;
    }
  | {
      modelType: 'image';
      model: import('../imageModelDownloadTypes').ImageModelDescriptor;
    }
  | { modelType: 'stt'; modelId: string };
