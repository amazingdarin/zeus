import { documentVersionService } from "./service.js";
import type { RecordDocumentVersionInput } from "./types.js";

type DispatcherDeps = {
  recordVersion: (input: RecordDocumentVersionInput) => Promise<unknown>;
};

export function createDocumentVersionDispatcher(
  deps: DispatcherDeps,
): (input: RecordDocumentVersionInput) => Promise<void> {
  return async (input: RecordDocumentVersionInput) => {
    try {
      await deps.recordVersion(input);
    } catch (err) {
      console.warn("[doc-version] failed to record version:", err);
    }
  };
}

export const documentVersionDispatcher = createDocumentVersionDispatcher({
  recordVersion: (input) => documentVersionService.recordVersion(input),
});

