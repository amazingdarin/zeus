# Zeus Project Guide
**Version 1.0**  
**Purpose: Enforce Architecture & Coding Discipline**

所有工程师（包括 AI 代码生成器）必须严格遵守本规范。

---

## 一、总体架构原则

### 1. Clean Architecture + Domain First

`api → service → domain → repository / infra`

#### 严格禁止
- service 层直接操作数据库
- api 层编写业务逻辑
- domain 层依赖 infra / repository
- handler 中直接调用对象存储 SDK

---

## 二、当前阶段红线（必须遵守）

在 **文档上传与整理阶段**，禁止以下行为：

- ❌ 自动生成任何 Spec
- ❌ 调用 LLM 抽象系统事实
- ❌ 写入 `module_snapshot`
- ❌ 写入 `rag_chunk`
- ❌ 做任何 RAG 检索

只允许以下行为：

- 原始文档存储
- 元数据提取与整理
- 文档类型分类（规则）
- 候选模块推断（低风险、带置信度）

---

## 三、目录结构规范（强制）

```text
/cmd
/internal
  /api                 # HTTP API 层
  /service
    /document           # 文档上传与整理业务
  /domain
    /document           # 原始文档领域模型
  /repository
    /postgres           # PostgreSQL 实现
    /objectstorage      # S3 / MinIO 实现
  /pipeline             # 文档处理流水线
  /util
```

---

## 四、Domain 层规范（必须遵守）

Domain 层必须是：
- 无 IO
- 无数据库
- 无 LLM
- 无外部依赖
- 仅包含：数据结构 + 业务不变规则

示例：

```go
type RawDocument struct {
    DocID    string
    Title    string
    Metadata DocumentMetadata
}

type DocumentMetadata struct {
    BatchID         string
    OriginalPath    string
    Category        string
    CandidateModule string
    Confidence      float64
    Status          string
}
```

## 五、Service 层规范

Service 层职责：
- 业务流程编排
- 调用 pipeline
- 调用 repository
- 处理事务边界

允许：
- 生成 batch_id
- 调用分类与模块推断逻辑
- 保存 raw_document

禁止：
- 解析 HTTP 请求
- 拼接 SQL
- 直接访问 S3 SDK

---

## 六、Repository 层规范

- 每个外部系统一个 repository
- 只负责数据读写
- 不包含业务规则

`SaveRawDocument(ctx context.Context, doc *RawDocument) error`

## 七、Pipeline 规范（文档处理）

Pipeline 是可组合、可测试的顺序处理单元：

```text
Upload
 → ExtractMetadata
 → Classify
 → GuessModule
 → Persist
```

Pipeline 严禁：
- 跳过步骤
- 回写 Spec
- 直接生成 ModuleSnapshot

## 八、命名规范（强制）

对象规则：
- Go struct PascalCase
- Go interface PascalCase + er
- 文件名 snake_case.go
- DocID DOC-XXXX
- BatchID batch-YYYYMMDD-xxx
- Module 全大写（AUTH / ORDER）

## 九、错误处理规范

- 所有函数必须返回 error
- 必须使用错误包装：

```go
return fmt.Errorf("save raw document failed: %w", err)
```

## 十、测试规范（当前阶段）

必须覆盖的测试：
- 文档类型分类规则
- 模块候选推断逻辑
- pipeline 顺序执行
- repository mock 测试

---

## 十一、Codex / LLM 使用规范（必须复制）
```
You are generating code for the Zeus project.
You MUST follow PROJECT_GUIDE.md strictly.
Current phase: Document Upload & Organization only.
Do NOT generate Spec, RAG, or ModuleSnapshot logic.
Do NOT violate layer boundaries.
```
