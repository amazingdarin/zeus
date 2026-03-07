import { v4 as uuidv4 } from "uuid";

import { documentStore } from "../../storage/document-store.js";
import type { Document } from "../../storage/types.js";
import { createCodeExecClient, type CodeExecClient } from "./client.js";
import {
  assertExecutableCodeBlock,
  type AssertExecutableCodeBlockInput,
  type ExecutableCodeBlockPayload,
} from "./guard.js";
import type {
  CodeExecRun,
  ExecuteCodeRequest,
  GetCodeRunRequest,
  ListCodeRunsRequest,
  ListCodeRunsResponse,
} from "./types.js";

export type RunCodeRequest = {
  userId: string;
  ownerType: "personal" | "team";
  ownerId: string;
  projectKey: string;
  docId: string;
  blockId: string;
  language: string;
  code: string;
  timeoutMs: number;
};

type GetDocumentFn = (userId: string, projectKey: string, docId: string) => Promise<Document>;
type GuardFn = (input: AssertExecutableCodeBlockInput) => ExecutableCodeBlockPayload;
type CreateRequestIdFn = () => string;

export type CodeExecServiceDeps = {
  getDocument: GetDocumentFn;
  guard: GuardFn;
  client: CodeExecClient;
  createRequestId: CreateRequestIdFn;
};

export type CodeExecService = {
  run(input: RunCodeRequest): Promise<CodeExecRun>;
  listRuns(input: ListCodeRunsRequest): Promise<ListCodeRunsResponse>;
  getRun(input: GetCodeRunRequest): Promise<CodeExecRun>;
};

function withDefaultDeps(deps?: Partial<CodeExecServiceDeps>): CodeExecServiceDeps {
  return {
    getDocument:
      deps?.getDocument ??
      ((userId, projectKey, docId) => documentStore.get(userId, projectKey, docId)),
    guard: deps?.guard ?? assertExecutableCodeBlock,
    client: deps?.client ?? createCodeExecClient(),
    createRequestId: deps?.createRequestId ?? (() => `code-exec-${uuidv4()}`),
  };
}

export function createCodeExecService(deps?: Partial<CodeExecServiceDeps>): CodeExecService {
  const resolved = withDefaultDeps(deps);

  return {
    async run(input: RunCodeRequest): Promise<CodeExecRun> {
      const doc = await resolved.getDocument(input.userId, input.projectKey, input.docId);
      const checked = resolved.guard({
        doc,
        blockId: input.blockId,
        language: input.language,
        code: input.code,
      });
      const payload: ExecuteCodeRequest = {
        requestId: resolved.createRequestId(),
        userId: input.userId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        projectKey: input.projectKey,
        docId: input.docId,
        blockId: checked.blockId,
        language: checked.language,
        code: checked.code,
        timeoutMs: input.timeoutMs,
      };
      return resolved.client.execute(payload);
    },

    listRuns(input: ListCodeRunsRequest): Promise<ListCodeRunsResponse> {
      return resolved.client.listRuns(input);
    },

    getRun(input: GetCodeRunRequest): Promise<CodeExecRun> {
      return resolved.client.getRun(input);
    },
  };
}

