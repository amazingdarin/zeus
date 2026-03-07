export type SyncMode = "local_only" | "remote_enabled";

export function resolveSyncMode(input: {
  isAuthenticated: boolean;
  documentAutoSync: boolean;
}): SyncMode {
  if (!input.isAuthenticated) {
    return "local_only";
  }
  return input.documentAutoSync ? "remote_enabled" : "local_only";
}

