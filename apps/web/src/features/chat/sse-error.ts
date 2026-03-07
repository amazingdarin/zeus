export const SSE_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSED: 2,
} as const;

type ShouldHandleSseDisconnectErrorInput = {
  isActiveSource: boolean;
  readyState: number;
};

/**
 * Only surface an SSE disconnect error when it comes from the current active stream
 * and the stream is truly closed.
 */
export const shouldHandleSseDisconnectError = (
  input: ShouldHandleSseDisconnectErrorInput,
): boolean => {
  if (!input.isActiveSource) {
    return false;
  }
  return input.readyState === SSE_READY_STATE.CLOSED;
};

