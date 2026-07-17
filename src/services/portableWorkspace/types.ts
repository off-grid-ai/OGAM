export interface WorkspaceFilePort {
  exists(path: string): Promise<boolean>;
  isOwnedImportPath(path: string): boolean;
  copy(sourcePath: string, destinationPath: string): Promise<void>;
  textDestination(id: string): string;
  materializeText(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}
