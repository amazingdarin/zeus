# Zeus

Zeus 是一个以 **系统规格（Spec）** 为核心的智能研发知识系统。

它能够将任意格式、任意结构的文档（Word / PDF / Markdown / Wiki 等）
自动整理、规范化、内聚为模块级知识视图（Module Snapshot），
并在此基础上通过 RAG 驱动研发、UI 自动化测试与运维智能化。

---

## 一、Zeus 解决什么问题？

在真实的软件研发过程中，知识通常存在以下问题：

- 分散在大量文档中
- 文档格式不统一、结构混乱
- 内容重复、冲突、过期
- 无法被程序或 AI 可靠使用

Zeus 的目标是：

> **让“系统说明”成为可执行、可演进、可被 AI 严格遵守的事实来源。**

---

## 二、核心设计理念

### 1. Spec 是唯一事实源（Single Source of Truth）

Zeus 不直接使用原始文档作为知识，而是将其抽象为结构化规格（Spec）：

- SystemSpec
- ModuleSpec
- PageSpec（UI 行为规格）
- ApiSpec
- DataSpec
- RequirementSpec

所有 Spec 都具有：
- Schema 校验
- 明确版本
- 可回溯来源

---

### 2. 文档 ≠ 知识

- 原始文档只用于：**输入、溯源、解释**
- 结构化 Spec 与模块聚合视图才是：**事实**

RAG、Agent、自动化测试 **只读取 Spec 与 ModuleSnapshot**。

---

### 3. 模块是一等公民（Module-Centric）

系统对外呈现的核心知识视图是：

> **模块级知识快照（ModuleSnapshot）**

它内聚了：
- 模块职责
- 页面 / 接口 / 数据
- 约束条件
- 冲突 / 过期状态

---

### 4. 所有智能必须可回退、可人工介入

- 自动整理 ≠ 自动定论
- 自动聚合 ≠ 自动修改事实
- 自动优化 ≠ 覆盖原文

---

## 三、当前阶段（MVP）

### 当前正在实现的能力

**阶段 1：文档上传 & 自动整理**

- 上传单文件 / 多文件 / 文件夹（zip）
- 保留原始目录结构
- 原始文件存储至对象存储（S3 / MinIO）
- 自动识别文档类型（需求 / 接口 / 设计 / 未知）
- 推断候选模块（带置信度）
- 存储原始文档元数据
- 提供 API / UI 供人工确认整理结果

### 当前明确不做的事情

- ❌ 不自动生成任何 Spec
- ❌ 不进入 RAG
- ❌ 不生成 ModuleSnapshot
- ❌ 不调用 LLM 抽象系统事实

---

## 四、系统整体数据流（简化）

```text
文档上传
  → 原始文档存储
  → 自动整理（分类 / 模块候选）
  → 人工确认
  → Spec 抽象（后续阶段）
  → ModuleSnapshot
  → RAG
  → Agent（Code / UI / Test / Ops）
```

## 五、技术栈（当前）

- Backend: Go
- Database: PostgreSQL
- Object Storage: S3 / MinIO
- Frontend: Web UI（后续）
- Vector DB / RAG: 后续阶段引入

---

## 六、从哪里开始看代码？

- 文档上传与整理：internal/service/document
- 文档处理流水线：internal/pipeline
- 领域模型：internal/domain/document
- 数据访问：internal/repository

## 七、重要提示（给 AI / Codex）

Zeus 是一个规格驱动系统。
当前阶段只允许实现「文档上传与自动整理」。
严禁生成 Spec、RAG 或 ModuleSnapshot。

详细工程规范请参阅 PROJECT_GUIDE.md。
