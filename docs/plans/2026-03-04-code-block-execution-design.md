# 文档代码块可执行功能设计

日期：2026-03-04  
状态：已确认（可进入实施计划）

## 1. 目标与范围

目标：在文档 `codeBlock` 中提供“受控执行”能力，支持特定语言运行并返回结果。

已确认范围：
1. 首期执行语言：`python`、`javascript/typescript`、`bash`。
2. 执行形态：一次性运行（Run），同步返回结果，不做 REPL、不做后台任务。
3. 网络策略：执行容器默认禁网。
4. 默认资源限制：`CPU 0.5`、`Memory 256Mi`、`timeout 10s`、`output 256KB`。
5. 数据职责：执行记录持久化在 `server` 侧，不落 `app-backend`。
6. 调用链路：`web -> app-backend(校验) -> code-runner(执行)`。

非目标（首期不做）：
1. 交互式 stdin/REPL。
2. 长任务异步队列与任务中心。
3. 自定义可出网策略。
4. 自定义执行镜像与用户级资源调节。

## 2. 方案对比与决策

### 方案 A：`app-backend` 直连 K8s 执行
优点：链路短。  
缺点：K8s 编排、安全策略、执行审计都混入业务后端，耦合高。

### 方案 B：独立 `code-runner` 执行服务（采用）
优点：
1. 执行沙箱、安全策略、K8s 调度集中管理。
2. `app-backend` 保持业务校验职责，边界清晰。
3. 后续可独立扩容与治理（并发、配额、镜像策略）。

缺点：新增服务间调用与内部鉴权。

### 方案 C：预热执行池
优点：低延迟。  
缺点：隔离难度更高，首期复杂度和风险偏大。

决策：首期采用 **方案 B**，并使用一次性 Job/Pod 执行。

## 3. 总体架构

请求路径：
1. Web 在代码块点击“运行”。
2. `app-backend` 进行业务校验（文档、块、权限、锁定状态、语言白名单、代码一致性）。
3. 校验通过后，`app-backend` 调用 `code-runner` 内部 API。
4. `code-runner` 创建受限 K8s Job/Pod 执行代码，收集输出并回传。
5. `code-runner` 将执行记录写入 `server` 侧存储（DB）。
6. `app-backend` 将标准化结果返回前端。

职责边界：
1. `web`：交互与展示，不直接接触 K8s。
2. `app-backend`：业务校验与转发，不持久化执行记录。
3. `code-runner`：执行编排、安全隔离、执行结果标准化。
4. `server`：执行记录持久化与审计查询能力承载。

## 4. 文档模型与协议

首期不新增节点类型，沿用 `codeBlock`，最小增量 attrs：
1. `execEnabled?: boolean`（默认 false）
2. `execLang?: "python" | "javascript" | "bash"`（为空则回退 `language`）

说明：
1. 执行结果不写入文档正文 JSON，避免污染正文与版本 diff。
2. 执行历史通过独立查询接口获取。

## 5. API 设计

## 5.1 `app-backend` 对 Web API（项目作用域）

前缀（遵循现有规范）：
`/api/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/code-exec`

1. `POST /run`
- 入参：
```json
{
  "blockId": "string",
  "language": "python|javascript|bash",
  "code": "string",
  "timeoutMs": 10000
}
```
- 出参：
```json
{
  "runId": "string",
  "status": "completed|failed|timeout",
  "result": {
    "stdout": "string",
    "stderr": "string",
    "exitCode": 0,
    "durationMs": 1234,
    "truncated": false,
    "timedOut": false
  }
}
```

2. `GET /runs`
- 查询当前文档/块执行历史（由 `code-runner` 持久化数据提供）。

3. `GET /runs/:runId`
- 查询单次执行详情。

## 5.2 `app-backend` 到 `code-runner` 内部 API

1. `POST /internal/execute`
- 仅内部访问（内网 token/mTLS）。
- 携带：`requestId userId owner/project docId blockId language code limits`。

2. `GET /internal/runs/:runId`
- 查询运行状态/结果（用于必要时补偿查询）。

## 6. 校验与安全策略

## 6.1 `app-backend` 校验

执行前必须全部通过：
1. 用户权限与 owner scope 校验。
2. 文档存在且可访问。
3. 文档未锁定（锁定返回业务错误）。
4. `blockId` 在该文档中存在，且类型为 `codeBlock`。
5. 请求 `language` 在白名单内。
6. 请求 `code` 与文档中该 `codeBlock` 内容一致（防篡改执行）。

## 6.2 `code-runner` K8s 安全基线

容器安全：
1. `runAsNonRoot: true`
2. `allowPrivilegeEscalation: false`
3. `privileged: false`
4. `readOnlyRootFilesystem: true`
5. `capabilities.drop: ["ALL"]`
6. `seccompProfile.type: RuntimeDefault`
7. `automountServiceAccountToken: false`

网络与存储：
1. 默认禁网（namespace + NetworkPolicy deny all）。
2. 仅挂载 `emptyDir` 到 `/tmp/work`（可配置 `sizeLimit`）。

资源与生命周期：
1. `requests`: `cpu 250m / memory 128Mi`
2. `limits`: `cpu 500m / memory 256Mi`
3. `activeDeadlineSeconds: 10`
4. 输出上限：`256KB`（超出截断并标记）
5. `ttlSecondsAfterFinished: 60`

## 6.3 镜像与语言映射

白名单镜像（固定 digest）：
1. Python runtime 镜像
2. Node runtime 镜像（js/ts）
3. Bash runtime 镜像

执行器根据语言选择镜像与启动命令，禁止用户自定义镜像。

## 7. 数据存储与审计

执行记录落 `server` 侧数据库，建议表：`document_code_runs`。

字段建议：
1. 标识：`id/run_id/request_id`
2. 范围：`owner_type/owner_id/project_key/doc_id/block_id/user_id`
3. 执行：`language/image_ref/status/exit_code`
4. 输出：`stdout/stderr/truncated/timed_out`
5. 资源：`cpu_limit/memory_limit_mb/timeout_ms`
6. 时间：`created_at/started_at/finished_at/duration_ms`
7. 审计：`code_sha256`（默认不落完整源码）

索引建议：
1. `(owner_type, owner_id, project_key, doc_id, block_id, created_at desc)`
2. `(run_id)` 唯一索引

## 8. 前端交互设计

代码块工具条新增：
1. 语言选择（仅三种）
2. `运行` 按钮
3. 最近状态徽标

运行结果面板展示：
1. `stdout`
2. `stderr`
3. `exitCode`
4. `durationMs`
5. `truncated/timedOut` 提示

交互规则：
1. 运行中按钮禁用，防重复提交。
2. 失败/超时给出明确错误文案。
3. 结果不写回正文，仅做运行结果展示。

## 9. 错误码设计

建议统一错误码：
1. `DOC_LOCKED`
2. `BLOCK_NOT_FOUND`
3. `BLOCK_NOT_EXECUTABLE`
4. `LANG_NOT_ALLOWED`
5. `CODE_MISMATCH`
6. `EXEC_TIMEOUT`
7. `EXEC_RESOURCE_EXCEEDED`
8. `EXEC_INTERNAL_ERROR`

## 10. 测试策略

## 10.1 单元测试
1. `app-backend`：文档锁校验、block/代码一致性校验、语言白名单。
2. `code-runner`：K8s spec 安全字段断言、超时与输出截断逻辑。

## 10.2 集成测试
1. `app-backend -> code-runner` 内部调用与错误透传。
2. `code-runner -> server DB` 执行记录写入与查询。

## 10.3 E2E（Playwright）
1. 文档代码块成功运行并展示输出。
2. 锁定文档运行被拒绝。
3. 超时场景提示正确。
4. 输出截断标记可见。

## 11. 风险与缓解

1. 风险：K8s 集群网络策略能力不一致。  
缓解：启动前做能力探测，不满足则禁用功能并暴露告警。

2. 风险：执行容器冷启动延迟影响体验。  
缓解：首期接受冷启动；后续可演进预热池。

3. 风险：前端提交代码与文档实际内容不一致。  
缓解：以后端“block 内容一致性校验”为准。

4. 风险：执行输出包含敏感信息。  
缓解：默认不持久化源码，输出长度限制并支持脱敏策略扩展。

## 12. 分阶段落地

1. Phase A：`app-backend` 校验 API + `code-runner` 最小执行链路（单语言先行可选）。
2. Phase B：三语言支持 + 完整安全策略 + 执行记录查询。
3. Phase C：审计完善、限流配额、观测指标与告警。

## 13. 结论

在既定约束下，采用“`app-backend` 业务校验 + 独立 `code-runner` 执行沙箱 + `server` 侧审计存储”的分层方案，能够在保证安全边界与可维护性的前提下，为文档代码块提供可控、可审计、可扩展的执行能力。
