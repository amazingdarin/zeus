# 文档代码块可执行能力 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为文档 `codeBlock` 提供受控执行能力（python/javascript/bash），通过 `web -> app-backend -> code-runner` 同步返回结果，并在 `server` 侧持久化执行记录。

**Architecture:** `app-backend` 负责权限/作用域/文档锁/块类型/代码一致性校验，并仅代理内部请求；`code-runner`（Go）负责 K8s 受限容器执行、超时与输出截断、结果持久化。前端在代码块内提供运行入口和结果面板，结果不写回文档正文，仅作为独立运行记录展示。

**Tech Stack:** TypeScript (Express/React/Tiptap), Go (Gin/GORM), Kubernetes Job API, PostgreSQL, node:test/tsx, Go test, Playwright CLI。

---

### Task 1: 建立 app-backend 代码执行协议与 code-runner 客户端

**Files:**
- Create: `apps/app-backend/src/services/code-exec/types.ts`
- Create: `apps/app-backend/src/services/code-exec/client.ts`
- Test: `apps/app-backend/tests/code-exec-client.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createCodeExecClient } from "../src/services/code-exec/client";

test("code-exec client sends internal token and normalizes response", async () => {
  let seenAuth = "";
  const client = createCodeExecClient({
    baseUrl: "http://runner.internal",
    internalToken: "runner-token",
    fetchImpl: async (_url, init) => {
      seenAuth = String((init?.headers as Record<string, string>)["x-code-runner-token"] ?? "");
      return new Response(JSON.stringify({
        code: "OK",
        data: { runId: "r1", status: "completed", result: { stdout: "ok", stderr: "", exitCode: 0, durationMs: 12, truncated: false, timedOut: false } },
      }), { status: 200 });
    },
  });

  const out = await client.execute({
    requestId: "req-1",
    userId: "u1",
    ownerType: "personal",
    ownerId: "u1",
    projectKey: "p1",
    docId: "d1",
    blockId: "b1",
    language: "python",
    code: "print('ok')",
    timeoutMs: 10000,
  });

  assert.equal(seenAuth, "runner-token");
  assert.equal(out.status, "completed");
  assert.equal(out.result.exitCode, 0);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/code-exec-client.test.ts`  
Expected: FAIL with module/function missing.

**Step 3: Write minimal implementation**

```ts
// types.ts
export type CodeExecLanguage = "python" | "javascript" | "bash";
export type CodeExecRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  truncated: boolean;
  timedOut: boolean;
};

// client.ts
export function createCodeExecClient(deps?: Partial<...>) {
  return {
    async execute(input) {
      const resp = await fetchImpl(`${baseUrl}/internal/code-exec/execute`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-code-runner-token": internalToken,
        },
        body: JSON.stringify(input),
      });
      // normalize + throw typed error on non-2xx
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/app-backend/tests/code-exec-client.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/code-exec/types.ts apps/app-backend/src/services/code-exec/client.ts apps/app-backend/tests/code-exec-client.test.ts
git commit -m "feat(app-backend): add code-exec client contract"
```

### Task 2: 实现 app-backend 执行前校验（权限/锁定/块一致性/语言白名单）

**Files:**
- Create: `apps/app-backend/src/services/code-exec/guard.ts`
- Test: `apps/app-backend/tests/code-exec-guard.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { assertExecutableCodeBlock } from "../src/services/code-exec/guard";

test("assertExecutableCodeBlock rejects code mismatch and locked docs", async () => {
  await assert.rejects(
    () => assertExecutableCodeBlock({
      doc: {
        meta: { extra: { lock: { locked: true, lockedBy: "u1", lockedAt: "2026-03-04T00:00:00Z" } } },
        body: { type: "tiptap", content: { type: "doc", content: [] } },
      } as any,
      blockId: "b1",
      language: "python",
      code: "print('x')",
    }),
    /DOCUMENT_LOCKED/,
  );
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/code-exec-guard.test.ts`  
Expected: FAIL with missing guard.

**Step 3: Write minimal implementation**

```ts
const ALLOWED_LANGS = new Set(["python", "javascript", "bash"]);

export function assertExecutableCodeBlock(input: {
  doc: Document;
  blockId: string;
  language: string;
  code: string;
}) {
  assertDocumentUnlocked(input.doc.meta);
  if (!ALLOWED_LANGS.has(input.language)) throw codeExecError("LANG_NOT_ALLOWED", 400);
  const block = findBlockById(input.doc.body.content, input.blockId);
  if (!block || block.type !== "codeBlock") throw codeExecError("BLOCK_NOT_EXECUTABLE", 404);
  const docCode = extractCodeBlockText(block);
  if (docCode !== input.code) throw codeExecError("CODE_MISMATCH", 409);
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/app-backend/tests/code-exec-guard.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/code-exec/guard.ts apps/app-backend/tests/code-exec-guard.test.ts
git commit -m "feat(app-backend): add code-exec document guards"
```

### Task 3: 实现 app-backend 执行服务编排（run/list/get）

**Files:**
- Create: `apps/app-backend/src/services/code-exec/service.ts`
- Test: `apps/app-backend/tests/code-exec-service.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createCodeExecService } from "../src/services/code-exec/service";

test("run delegates to guard then code-runner client", async () => {
  let guardCalled = false;
  let executeCalled = false;
  const svc = createCodeExecService({
    guard: async () => { guardCalled = true; },
    client: {
      execute: async () => {
        executeCalled = true;
        return { runId: "r1", status: "completed", result: { stdout: "ok", stderr: "", exitCode: 0, durationMs: 3, truncated: false, timedOut: false } };
      },
      listRuns: async () => ({ items: [], nextCursor: "" }),
      getRun: async () => ({ runId: "r1", status: "completed", result: { stdout: "", stderr: "", exitCode: 0, durationMs: 1, truncated: false, timedOut: false } }),
    } as any,
  });

  await svc.run({ userId: "u1", ownerType: "personal", ownerId: "u1", projectKey: "p1", docId: "d1", blockId: "b1", language: "python", code: "print(1)", timeoutMs: 10000 });
  assert.equal(guardCalled, true);
  assert.equal(executeCalled, true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/app-backend/tests/code-exec-service.test.ts`  
Expected: FAIL with service missing.

**Step 3: Write minimal implementation**

```ts
export function createCodeExecService(deps?: Partial<...>) {
  return {
    async run(input) {
      await guard(input);
      return client.execute(input);
    },
    async listRuns(input) {
      return client.listRuns(input);
    },
    async getRun(input) {
      return client.getRun(input);
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/app-backend/tests/code-exec-service.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/src/services/code-exec/service.ts apps/app-backend/tests/code-exec-service.test.ts
git commit -m "feat(app-backend): add code-exec orchestration service"
```

### Task 4: 接入 app-backend 路由与 Web API

**Files:**
- Modify: `apps/app-backend/src/router.ts`
- Modify: `apps/web/src/api/documents.ts`
- Test: `apps/web/tests/document-code-exec-api.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildCodeExecRunPath } from "../src/api/documents";

test("buildCodeExecRunPath uses scoped project route", () => {
  const path = buildCodeExecRunPath("personal::me::p1", "d1");
  assert.equal(path, "/api/projects/personal/me/p1/documents/d1/code-exec/run");
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/document-code-exec-api.test.ts`  
Expected: FAIL with helper missing.

**Step 3: Write minimal implementation**

在 `router.ts` 新增：

```ts
router.post("/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/code-exec/run", ...);
router.get("/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/code-exec/runs", ...);
router.get("/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/code-exec/runs/:runId", ...);
```

在 `documents.ts` 新增：

```ts
export async function runDocumentCodeBlock(projectKey: string, docId: string, input: {...}) { ... }
export async function listDocumentCodeRuns(projectKey: string, docId: string, cursor?: string) { ... }
export async function getDocumentCodeRun(projectKey: string, docId: string, runId: string) { ... }
```

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/document-code-exec-api.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/app-backend/src/router.ts apps/web/src/api/documents.ts apps/web/tests/document-code-exec-api.test.ts
git commit -m "feat(api): expose document code-exec routes and web client"
```

### Task 5: 增加 server 侧执行记录模型与数据库表

**Files:**
- Create: `server/internal/modules/codeexec/repository/repository.go`
- Create: `server/internal/modules/codeexec/repository/postgres/code_run.go`
- Create: `server/internal/modules/codeexec/repository/postgres/model/code_run.go`
- Modify: `ddl/migrations/server.postgres/20260301-001-v1.0.0/up.sql`
- Modify: `ddl/migrations/server.postgres/20260301-001-v1.0.0/down.sql`
- Modify: `ddl/sql/init.server.postgres.sql`
- Modify: `ddl/sql/init.sql`
- Modify: `deploy/helm/charts/charts/postgres/files/init.sql`
- Test: `server/internal/modules/codeexec/repository/postgres/code_run_test.go`

**Step 1: Write the failing test**

```go
func TestCodeRunRepository_InsertAndFind(t *testing.T) {
    repo := newTestCodeRunRepo(t)
    in := &model.CodeRun{RunID: "run-1", OwnerType: "personal", OwnerID: "u1", ProjectKey: "p1", DocID: "d1", BlockID: "b1", Language: "python", Status: "completed"}
    require.NoError(t, repo.Insert(context.Background(), in))

    got, err := repo.FindByRunID(context.Background(), "run-1")
    require.NoError(t, err)
    require.Equal(t, "python", got.Language)
}
```

**Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/modules/codeexec/repository/postgres -run TestCodeRunRepository_InsertAndFind -v`  
Expected: FAIL (missing repository/table/model).

**Step 3: Write minimal implementation**

```go
type CodeRun struct {
  ID        string `gorm:"column:id;primaryKey"`
  RunID     string `gorm:"column:run_id;uniqueIndex;not null"`
  OwnerType string `gorm:"column:owner_type;not null"`
  OwnerID   string `gorm:"column:owner_id;not null"`
  ProjectKey string `gorm:"column:project_key;not null"`
  DocID      string `gorm:"column:doc_id;not null"`
  BlockID    string `gorm:"column:block_id;not null"`
  Language   string `gorm:"column:language;not null"`
  Status     string `gorm:"column:status;not null"`
  Stdout     string `gorm:"column:stdout"`
  Stderr     string `gorm:"column:stderr"`
  ExitCode   int    `gorm:"column:exit_code"`
}
```

SQL 增量（在现有 `20260301-001-v1.0.0` 内追加）：
- `document_code_runs` 表
- `run_id` 唯一索引
- `(owner_type, owner_id, project_key, doc_id, block_id, created_at desc)` 索引

**Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/modules/codeexec/repository/postgres -run TestCodeRunRepository_InsertAndFind -v`  
Expected: PASS.

**Step 5: Commit**

```bash
git add server/internal/modules/codeexec/repository/repository.go server/internal/modules/codeexec/repository/postgres/code_run.go server/internal/modules/codeexec/repository/postgres/model/code_run.go ddl/migrations/server.postgres/20260301-001-v1.0.0/up.sql ddl/migrations/server.postgres/20260301-001-v1.0.0/down.sql ddl/sql/init.server.postgres.sql ddl/sql/init.sql deploy/helm/charts/charts/postgres/files/init.sql server/internal/modules/codeexec/repository/postgres/code_run_test.go
git commit -m "feat(server): add document code run persistence"
```

### Task 6: 实现 code-runner K8s Job 规格构建与安全限制

**Files:**
- Create: `server/internal/modules/codeexec/service/job_spec.go`
- Test: `server/internal/modules/codeexec/service/job_spec_test.go`

**Step 1: Write the failing test**

```go
func TestBuildJobSpec_EnforcesSecurityAndLimits(t *testing.T) {
    spec := BuildJobSpec(JobInput{
        RunID: "run-1",
        Language: "python",
        Code: "print('ok')",
        TimeoutSeconds: 10,
    })

    c := spec.Spec.Template.Spec.Containers[0]
    require.Equal(t, "Never", string(spec.Spec.Template.Spec.RestartPolicy))
    require.Equal(t, int64(10), *spec.Spec.ActiveDeadlineSeconds)
    require.NotNil(t, c.SecurityContext)
    require.Equal(t, true, *c.SecurityContext.RunAsNonRoot)
    require.Equal(t, false, *c.SecurityContext.AllowPrivilegeEscalation)
    require.Equal(t, true, *c.SecurityContext.ReadOnlyRootFilesystem)
}
```

**Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/modules/codeexec/service -run TestBuildJobSpec_EnforcesSecurityAndLimits -v`  
Expected: FAIL (spec builder missing).

**Step 3: Write minimal implementation**

```go
func BuildJobSpec(in JobInput) *batchv1.Job {
  return &batchv1.Job{
    Spec: batchv1.JobSpec{
      TTLSecondsAfterFinished: ptr.To[int32](60),
      ActiveDeadlineSeconds:   ptr.To[int64](int64(in.TimeoutSeconds)),
      Template: corev1.PodTemplateSpec{
        Spec: corev1.PodSpec{
          RestartPolicy:                 corev1.RestartPolicyNever,
          AutomountServiceAccountToken:  ptr.To(false),
          Containers: []corev1.Container{{
            Name: "runner",
            Image: resolveRuntimeImage(in.Language),
            SecurityContext: &corev1.SecurityContext{
              RunAsNonRoot:             ptr.To(true),
              AllowPrivilegeEscalation: ptr.To(false),
              ReadOnlyRootFilesystem:   ptr.To(true),
              Capabilities: &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
            },
            Resources: buildDefaultResources(), // 0.5 CPU / 256Mi
          }},
        },
      },
    },
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/modules/codeexec/service -run TestBuildJobSpec_EnforcesSecurityAndLimits -v`  
Expected: PASS.

**Step 5: Commit**

```bash
git add server/internal/modules/codeexec/service/job_spec.go server/internal/modules/codeexec/service/job_spec_test.go
git commit -m "feat(code-runner): enforce k8s sandbox job spec"
```

### Task 7: 实现 code-runner 执行服务（启动 Job、收集日志、超时与截断）

**Files:**
- Create: `server/internal/modules/codeexec/service/executor.go`
- Create: `server/internal/modules/codeexec/service/types.go`
- Test: `server/internal/modules/codeexec/service/executor_test.go`

**Step 1: Write the failing test**

```go
func TestNormalizeOutput_TruncateAndTimeout(t *testing.T) {
    out := normalizeOutput(strings.Repeat("a", 300*1024), "", 137, 256*1024, true, 10023)
    require.True(t, out.Truncated)
    require.True(t, out.TimedOut)
    require.Equal(t, 256*1024, len(out.Stdout))
}
```

**Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/modules/codeexec/service -run TestNormalizeOutput_TruncateAndTimeout -v`  
Expected: FAIL.

**Step 3: Write minimal implementation**

```go
type ExecuteResult struct {
  Stdout     string
  Stderr     string
  ExitCode   int
  DurationMs int64
  Truncated  bool
  TimedOut   bool
}

func normalizeOutput(stdout, stderr string, exitCode int, limit int, timedOut bool, durationMs int64) ExecuteResult {
  trimmed, truncated := truncateUTF8(stdout, limit)
  return ExecuteResult{
    Stdout: trimmed,
    Stderr: stderr,
    ExitCode: exitCode,
    DurationMs: durationMs,
    Truncated: truncated,
    TimedOut: timedOut,
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/modules/codeexec/service -run TestNormalizeOutput_TruncateAndTimeout -v`  
Expected: PASS.

**Step 5: Commit**

```bash
git add server/internal/modules/codeexec/service/executor.go server/internal/modules/codeexec/service/types.go server/internal/modules/codeexec/service/executor_test.go
git commit -m "feat(code-runner): add execution runtime and output normalization"
```

### Task 8: 暴露 code-runner API，并完成 server 进程/部署接入

**Files:**
- Create: `server/cmd/code-runner/main.go`
- Create: `server/internal/modules/codeexec/api/handler.go`
- Create: `server/internal/modules/codeexec/api/types.go`
- Modify: `server/internal/config/config.go`
- Modify: `server/config.yaml`
- Modify: `server/Dockerfile`
- Modify: `Makefile`
- Modify: `deploy/helm/charts/values.yaml`
- Create: `deploy/helm/charts/templates/code-runner-deployment.yaml`
- Create: `deploy/helm/charts/templates/code-runner-service.yaml`
- Create: `deploy/helm/charts/templates/code-runner-networkpolicy.yaml`

**Step 1: Write the failing test**

```go
func TestInternalTokenMiddleware(t *testing.T) {
    h := newTokenProtectedHandler("runner-token")
    req := httptest.NewRequest(http.MethodPost, "/internal/code-exec/execute", nil)
    w := httptest.NewRecorder()
    h.ServeHTTP(w, req)
    require.Equal(t, http.StatusUnauthorized, w.Code)
}
```

**Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/modules/codeexec/api -run TestInternalTokenMiddleware -v`  
Expected: FAIL (API/middleware missing).

**Step 3: Write minimal implementation**

```go
router.POST("/internal/code-exec/execute", tokenGuard(cfg.CodeRunner.InternalToken), handler.Execute)
router.GET("/internal/code-exec/runs/:runId", tokenGuard(cfg.CodeRunner.InternalToken), handler.GetRun)
router.GET("/internal/code-exec/runs", tokenGuard(cfg.CodeRunner.InternalToken), handler.ListRuns)
```

新增配置：

```go
type CodeRunnerConfig struct {
  Addr string `mapstructure:"addr"`
  InternalToken string `mapstructure:"internal_token"`
  Namespace string `mapstructure:"namespace"`
  DefaultTimeoutSeconds int `mapstructure:"default_timeout_seconds"`
  MaxOutputBytes int `mapstructure:"max_output_bytes"`
}
```

**Step 4: Run test and render verification**

Run: `cd server && go test ./internal/modules/codeexec/api -run TestInternalTokenMiddleware -v`  
Expected: PASS.

Run: `helm template zeus deploy/helm/charts -f deploy/helm/charts/values.yaml >/tmp/zeus-code-runner-helm.yaml`  
Expected: PASS (manifest successfully rendered).

**Step 5: Commit**

```bash
git add server/cmd/code-runner/main.go server/internal/modules/codeexec/api/handler.go server/internal/modules/codeexec/api/types.go server/internal/config/config.go server/config.yaml server/Dockerfile Makefile deploy/helm/charts/values.yaml deploy/helm/charts/templates/code-runner-deployment.yaml deploy/helm/charts/templates/code-runner-service.yaml deploy/helm/charts/templates/code-runner-networkpolicy.yaml
git commit -m "feat(server): add code-runner service and deployment wiring"
```

### Task 9: 文档页集成执行状态与代码块“运行”入口

**Files:**
- Modify: `packages/doc-editor/src/nodes/code-block-node/code-block-node-extension.ts`
- Modify: `packages/doc-editor/src/nodes/code-block-node/code-block-node.tsx`
- Modify: `packages/doc-editor/src/nodes/code-block-node/code-block-node.scss`
- Modify: `packages/doc-editor/src/templates/simple/doc-editor.tsx`
- Modify: `apps/web/src/components/RichTextEditor.tsx`
- Modify: `apps/web/src/components/DocumentWorkspace.tsx`
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Test: `packages/doc-editor/tests/code-block-exec-ui.test.ts`
- Test: `apps/web/tests/document-code-exec-state.test.ts`

**Step 1: Write the failing tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { resolveCodeExecButtonState } from "../src/nodes/code-block-node/code-block-node";

test("run button disabled when locked or running", () => {
  assert.equal(resolveCodeExecButtonState({ editable: true, locked: false, running: true }).disabled, true);
  assert.equal(resolveCodeExecButtonState({ editable: true, locked: true, running: false }).disabled, true);
});
```

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { reduceCodeExecState } from "../src/features/document-page/code-exec-state";

test("success event stores run result by block id", () => {
  const next = reduceCodeExecState({}, { type: "run-success", blockId: "b1", runId: "r1" } as any);
  assert.equal(next["b1"]?.runId, "r1");
});
```

**Step 2: Run tests to verify they fail**

Run: `node --import tsx --test packages/doc-editor/tests/code-block-exec-ui.test.ts apps/web/tests/document-code-exec-state.test.ts`  
Expected: FAIL with missing helpers/state.

**Step 3: Write minimal implementation**

核心接口：

```ts
// code-block-node-extension.ts
export type CodeExecTrigger = (input: { blockId: string; language: string; code: string }) => Promise<void>;

// doc-editor.tsx props
onCodeExecRun?: CodeExecTrigger;
codeExecStateByBlockId?: Record<string, { running: boolean; lastStatus?: string; lastRunId?: string }>;
```

`DocumentPage` 中维护 `codeExecStateByBlockId`，执行流程：
1. 调 `runDocumentCodeBlock(...)`
2. 更新块状态为 running -> completed/failed/timeout
3. 触发消息提示，不写回正文 JSON

**Step 4: Run tests to verify they pass**

Run: `node --import tsx --test packages/doc-editor/tests/code-block-exec-ui.test.ts apps/web/tests/document-code-exec-state.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/doc-editor/src/nodes/code-block-node/code-block-node-extension.ts packages/doc-editor/src/nodes/code-block-node/code-block-node.tsx packages/doc-editor/src/nodes/code-block-node/code-block-node.scss packages/doc-editor/src/templates/simple/doc-editor.tsx apps/web/src/components/RichTextEditor.tsx apps/web/src/components/DocumentWorkspace.tsx apps/web/src/pages/DocumentPage.tsx packages/doc-editor/tests/code-block-exec-ui.test.ts apps/web/tests/document-code-exec-state.test.ts
git commit -m "feat(web): add code-block run interaction and state mapping"
```

### Task 10: 协议文档与全链路回归验证（含 Playwright）

**Files:**
- Modify: `openspec/specs/document-format/specs/block-types.spec.md`
- Create: `output/playwright/document-code-exec-regression.js`
- Create: `output/playwright/document-code-exec-regression.md`

**Step 1: Write regression script**

`output/playwright/document-code-exec-regression.js` 覆盖场景：
1. 打开文档，新增 `python` 代码块，点击“运行”成功展示 `stdout`。
2. 锁定文档后“运行”按钮禁用或返回 `DOCUMENT_LOCKED` 提示。
3. 模拟超时任务，展示 `timedOut=true` 标识。
4. 结果展示不导致文档正文变更（刷新后正文不含执行输出）。

账号读取（必须）：

```js
const account = JSON.parse(fs.readFileSync("output/playwright/test-account.json", "utf8"));
```

**Step 2: Run browser test to verify gaps**

Run: `playwright-cli run output/playwright/document-code-exec-regression.js`  
Expected: 首轮在功能未全部接通前 FAIL（用于暴露缺口）。

**Step 3: Fix remaining gaps and rerun**

按失败断言做最小改动，直到回归脚本通过。

**Step 4: Run full verification**

Run: `node --import tsx --test apps/app-backend/tests/code-exec-client.test.ts apps/app-backend/tests/code-exec-guard.test.ts apps/app-backend/tests/code-exec-service.test.ts apps/web/tests/document-code-exec-api.test.ts apps/web/tests/document-code-exec-state.test.ts packages/doc-editor/tests/code-block-exec-ui.test.ts`  
Expected: PASS。

Run: `cd server && go test ./internal/modules/codeexec/...`  
Expected: PASS。

Run: `npm run test:unified-editor`  
Expected: PASS。

Run: `playwright-cli run output/playwright/document-code-exec-regression.js`  
Expected: PASS，并生成 `output/playwright/document-code-exec-regression.md`。

**Step 5: Commit**

```bash
git add openspec/specs/document-format/specs/block-types.spec.md output/playwright/document-code-exec-regression.js output/playwright/document-code-exec-regression.md
git commit -m "test(web): add code-block execution regression coverage"
```

## Execution Notes

1. 严格按 `@test-driven-development` 执行：每个任务先红后绿再提交。
2. 发现异常先走 `@systematic-debugging`，先最小复现再修复。
3. 完成前必须执行 `@verification-before-completion` 全量命令并记录结果。
4. 前端变更必须执行 `@playwright`，并使用固定账号文件 `output/playwright/test-account.json`。
5. 每个任务单独 commit，保持可回滚、可审阅。

