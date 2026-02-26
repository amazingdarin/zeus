export type MigrationId = {
  id: string;
  date: string;
  seqRaw: string;
  seq: number;
  schemaVersion: string;
};

export type ReleaseMatrixRelease = {
  app_version: string;
  tracks: Record<string, string>;
};

export type ReleaseMatrix = {
  version: number;
  description?: string;
  targets: Record<string, string[]>;
  releases: ReleaseMatrixRelease[];
};
