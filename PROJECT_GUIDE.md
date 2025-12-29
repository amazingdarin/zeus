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
    /raw_document           # 文档上传与整理业务
  /domain               # 领域模型
  /repository
    /postgres           # PostgreSQL 实现
      /model            # PostgreSQL 数据模型定义
      /mapper           # PostgreSQL 数据模型与 Domain 领域的映射
  /infra
    /s3      # S3 实现
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
```text
You are generating code for the Zeus project.
You MUST follow PROJECT_GUIDE.md strictly.
Current phase: Document Upload & Organization only.
Do NOT generate Spec, RAG, or ModuleSnapshot logic.
Do NOT violate layer boundaries.
```

---

## 十二、GORM Repository 规范（强制）

本项目使用 **GORM** 作为 ORM 框架，但其使用范围受到严格限制。

> **GORM 仅允许存在于 Repository 的具体实现层（Implementation）中。**  
> **任何 Domain / Service / API 层代码都不得直接或间接依赖 GORM。**

---

### 12.1 GORM 使用边界（红线）

#### ✅ 允许

- GORM 仅用于 PostgreSQL Repository 实现
- 使用 `gorm.DB` 进行 CRUD
- 使用 `datatypes.JSON` 映射 `jsonb`
- 使用 `WithContext(ctx)`
- 使用 `Transaction`（仅限 Repository 内）

#### ❌ 严禁

- 在 Domain 层定义 GORM Model 或 gorm tag
- 在 Service / API 层 import GORM
- 在 Handler 中直接使用 `db.Create / db.Find`
- 使用 `AutoMigrate()` 作为生产迁移方案
- 直接将 GORM Model 返回给上层

---

### 12.2 Domain Model 与 GORM Model 必须分离

#### Domain Model（纯净）

- 仅表达业务概念
- 不包含：
  - gorm tag
  - 表名
  - 主键 ID
  - ORM 行为

示例：

```go
type RawDocument struct {
    DocID      string
    SourceType string
    SourceURI  string
    Title      string
    Metadata   DocumentMetadata
    CreatedAt  time.Time
}
```

---

## 十三、API 定义规范（RESTful + 模块化）

本项目所有对外 HTTP API **必须遵循模块化 RESTful 设计规范**。  
API 定义以 **模块（Module）** 为第一层划分，以 **资源（Resource）** 为核心。

OpenAPI 3.1 是 API 的唯一事实源（Single Source of Truth）。

---

### 13.1 API 总体原则（必须遵守）

#### 1. 模块优先（Module-First）

- API 必须按业务模块划分
- 每个模块拥有清晰、独立的 URL 前缀
- 不允许跨模块混杂资源

示例：

```text
/api/knowledge/...
/api/uploads/...
/api/raw-documents/...
```

#### 2. RESTful 资源导向（Resource-Oriented）

- URL 表示资源
- HTTP Method 表示动作
- 不在 URL 中出现动词

**✅ 正确：**
```text
POST   /api/uploads
GET    /api/raw-documents
GET    /api/raw-documents/{doc_id}
```

**❌ 错误：**
```text
POST /api/uploadFile
GET  /api/getRawDocuments
```

#### 3. API = 契约，不是实现

- API 定义只描述：请求 / 响应 / 错误
- 不暴露：数据库结构 / ORM 细节 / 内部状态

### 13.2 URL 结构规范（强制）

**标准结构**
```text
/api/{module}/{resource}/{resource_id}/{sub_resource}
```

**规则**
- {module}：模块名，小写 + 短名词
- {resource}：资源名，复数
- {resource_id}：资源唯一标识
- {sub_resource}：资源的子资源（可选）

示例：
```text
/api/uploads
/api/uploads/{batch_id}/files
/api/raw-documents
/api/raw-documents/{doc_id}
```

### 13.3 模块划分规则（Zeus 规范）

**当前核心模块（示例）**

| 模块 | URL前缀 | 说明 |
| --- | --- | --- |
| Upload | /api/uploads | 文档导入与批次管理 |
| Knowledge | /api/knowledge | 知识库与模块视图 |
| Document | /api/raw-documents | 原始文档管理 |

模块一旦发布，不允许随意合并或拆分。

### 13.4 HTTP Method 使用规范（强制）
**Method 用途**

| Method | 用途 |
| --- | --- |
| GET | 查询资源 |
| POST | 创建资源 |
| PUT | 整体更新资源 |
| PATCH | 部分更新资源 |
| DELETE | 删除资源 |

示例：
```text
POST   /api/uploads                # 创建上传批次
POST   /api/uploads/{id}/files     # 向批次添加文件
GET    /api/raw-documents          # 查询文档列表
GET    /api/raw-documents/{doc_id} # 查询单个文档
```

### 13.5 查询与过滤规范（Query）
- 查询条件一律使用 query parameter
- 不使用 body 进行查询
- 支持分页的接口必须包含：`limit`、`offset`

示例：
```text
GET /api/raw-documents?batch_id=xxx&limit=20&offset=0
```

### 13.6 响应结构规范（强制）
**列表响应**
```json
{
  "data": [...],
  "total": 100
}
```

**单资源响应**
```json
{
  "data": { ... }
}
```

### 13.7 错误响应规范（统一）

所有错误必须使用统一结构：
```json
{
  "code": "INVALID_REQUEST",
  "message": "Invalid request payload"
}
```
- code：稳定错误码（用于程序判断）
- message：面向人的错误信息

### 13.8 命名规范（强制）

**URL**

- 全小写
- 使用 - 分隔
- 不使用驼峰

**JSON 字段**

- snake_case
- 与 OpenAPI schema 保持一致

---

### 13.9 OpenAPI 使用规范（强制）
- 每一个 API 必须在 openapi.yaml 中定义
- OpenAPI 是后端代码生成源
- OpenAPI 是前端 SDK 生成源
- OpenAPI 是接口文档生成源
- 禁止手写未定义的 API

---

### 13.10 Codex / LLM 生成 API 的约束

使用 Codex 生成 API 时，必须遵循以下规则：
```text
All APIs must:
- Be defined per module
- Follow RESTful resource-oriented design
- Use plural resource names
- Avoid verbs in URLs
- Be added to openapi.yaml first
- Follow the unified response and error format
```

违反上述任一规则，生成结果必须被拒绝并重写。

---
