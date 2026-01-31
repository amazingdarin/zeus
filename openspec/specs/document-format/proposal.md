# Zeus 文档格式规范

## 概述

本规范定义了 Zeus 智能文档管理系统的文档格式标准，基于 Tiptap 富文本编辑器的 JSON 结构。

## 目标

1. **标准化文档结构** - 确保所有文档遵循统一的 JSON Schema
2. **支持 AI 生成** - 为 AI 助手提供明确的格式规范，以便生成符合标准的文档内容
3. **跨平台兼容** - Web、Desktop、API 三端使用相同的文档格式
4. **可扩展性** - 支持自定义 Block 类型和扩展属性

## 范围

本规范涵盖：

- 文档元数据结构（meta）
- 文档正文结构（body/content）
- 所有支持的 Block 类型及其属性
- 内联 Marks（格式标记）
- JSON 示例

## 背景

Zeus 使用 [Tiptap](https://tiptap.dev) 作为核心编辑器，Tiptap 是基于 ProseMirror 的现代富文本编辑框架。文档内容以 JSON 格式存储，包含节点树结构。

## 技术栈

- **编辑器**: Tiptap + ProseMirror
- **存储格式**: JSON
- **前端**: React + TypeScript
- **后端**: TypeScript (Express) / Go (Gin)
