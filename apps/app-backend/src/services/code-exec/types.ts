export type CodeExecOwnerType = "personal" | "team";

export type CodeExecLanguage = "python" | "javascript" | "typescript" | "bash";

export type CodeExecRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timeout";

export type CodeExecRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  truncated: boolean;
  timedOut: boolean;
};

export type ExecuteCodeRequest = {
  requestId: string;
  userId: string;
  ownerType: CodeExecOwnerType;
  ownerId: string;
  projectKey: string;
  docId: string;
  blockId: string;
  language: CodeExecLanguage;
  code: string;
  timeoutMs: number;
};

export type CodeExecRun = {
  runId: string;
  status: CodeExecRunStatus;
  result: CodeExecRunResult;
};

export type ListCodeRunsRequest = {
  ownerType: CodeExecOwnerType;
  ownerId: string;
  projectKey: string;
  docId: string;
  blockId?: string;
  cursor?: string;
  limit?: number;
};

export type ListCodeRunsResponse = {
  items: CodeExecRun[];
  nextCursor?: string;
};

export type GetCodeRunRequest = {
  ownerType: CodeExecOwnerType;
  ownerId: string;
  projectKey: string;
  docId: string;
  runId: string;
};
