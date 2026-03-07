export type CodeExecRunStatus = "queued" | "running" | "completed" | "failed" | "timeout";

export type CodeExecBlockState = {
  running: boolean;
  lastStatus?: CodeExecRunStatus;
  lastRunId?: string;
};

export type CodeExecState = Record<string, CodeExecBlockState>;

export type CodeExecStateEvent =
  | { type: "run-start"; blockId: string }
  | { type: "run-success"; blockId: string; runId: string; status: CodeExecRunStatus }
  | { type: "run-error"; blockId: string; status?: CodeExecRunStatus }
  | { type: "clear-block"; blockId: string }
  | { type: "reset" };

export function createCodeExecState(): CodeExecState {
  return {};
}

function normalizeBlockId(blockId: string): string {
  return String(blockId ?? "").trim();
}

function ensureBlockState(
  state: CodeExecState,
  blockId: string,
): CodeExecBlockState {
  return state[blockId] ?? { running: false };
}

export function reduceCodeExecState(
  state: CodeExecState,
  event: CodeExecStateEvent,
): CodeExecState {
  if (event.type === "reset") {
    if (Object.keys(state).length === 0) {
      return state;
    }
    return {};
  }

  const blockId = normalizeBlockId(event.blockId);
  if (!blockId) {
    return state;
  }

  if (event.type === "clear-block") {
    if (!(blockId in state)) {
      return state;
    }
    const next = { ...state };
    delete next[blockId];
    return next;
  }

  const current = ensureBlockState(state, blockId);

  if (event.type === "run-start") {
    const nextBlock: CodeExecBlockState = {
      ...current,
      running: true,
      lastStatus: "running",
    };
    if (
      nextBlock.running === current.running
      && nextBlock.lastStatus === current.lastStatus
      && nextBlock.lastRunId === current.lastRunId
    ) {
      return state;
    }
    return {
      ...state,
      [blockId]: nextBlock,
    };
  }

  if (event.type === "run-success") {
    return {
      ...state,
      [blockId]: {
        running: false,
        lastRunId: String(event.runId ?? ""),
        lastStatus: event.status,
      },
    };
  }

  return {
    ...state,
    [blockId]: {
      ...current,
      running: false,
      lastStatus: event.status ?? "failed",
    },
  };
}
