import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldHandleSseDisconnectError,
  SSE_READY_STATE,
} from "../src/features/chat/sse-error";

test("handles disconnect only for active closed stream", () => {
  assert.equal(
    shouldHandleSseDisconnectError({
      isActiveSource: true,
      readyState: SSE_READY_STATE.CLOSED,
    }),
    true,
  );
});

test("ignores stale stream disconnect events", () => {
  assert.equal(
    shouldHandleSseDisconnectError({
      isActiveSource: false,
      readyState: SSE_READY_STATE.CLOSED,
    }),
    false,
  );
});

test("ignores reconnecting stream errors", () => {
  assert.equal(
    shouldHandleSseDisconnectError({
      isActiveSource: true,
      readyState: SSE_READY_STATE.CONNECTING,
    }),
    false,
  );
});

test("ignores open stream errors", () => {
  assert.equal(
    shouldHandleSseDisconnectError({
      isActiveSource: true,
      readyState: SSE_READY_STATE.OPEN,
    }),
    false,
  );
});

