export type LockFallbackState = {
  readonly: boolean;
};

export type LockFallbackError = {
  code?: string;
  status?: number;
};

export function reduceLockFallbackState(
  state: LockFallbackState,
  error: LockFallbackError,
): LockFallbackState {
  if (error.status === 423 || error.code === "DOCUMENT_LOCKED") {
    return { readonly: true };
  }
  return state;
}
