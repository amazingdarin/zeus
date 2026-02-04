import type { OptimizeCapabilityId } from "./types.js";

export type OptimizeCapability = {
  id: OptimizeCapabilityId;
  mode: "format" | "content" | "style" | "full";
  command: string;
  description: string;
  thinkingText: string;
  outputMessage: string;
  temperature: number;
  preserveStructure: boolean;
};

const OPTIMIZE_CAPABILITIES: Record<OptimizeCapabilityId, OptimizeCapability> = {
  "doc-optimize-format": {
    id: "doc-optimize-format",
    mode: "format",
    command: "/doc-optimize-format",
    description: "优化文档格式，规范标题层级、列表、代码块和段落结构。",
    thinkingText: "正在优化文档格式...",
    outputMessage: "文档格式优化草稿已生成",
    temperature: 0.25,
    preserveStructure: true,
  },
  "doc-optimize-content": {
    id: "doc-optimize-content",
    mode: "content",
    command: "/doc-optimize-content",
    description: "优化文档内容，提升表达质量和逻辑连贯性。",
    thinkingText: "正在优化文档内容...",
    outputMessage: "文档内容优化草稿已生成",
    temperature: 0.45,
    preserveStructure: true,
  },
  "doc-optimize-style": {
    id: "doc-optimize-style",
    mode: "style",
    command: "/doc-optimize-style",
    description: "按目标风格改写文档内容，保持事实和关键信息。",
    thinkingText: "正在进行文档风格转换...",
    outputMessage: "文档风格优化草稿已生成",
    temperature: 0.5,
    preserveStructure: true,
  },
  "doc-optimize-full": {
    id: "doc-optimize-full",
    mode: "full",
    command: "/doc-optimize-full",
    description: "同时优化文档格式与内容，输出更易读、更专业的版本。",
    thinkingText: "正在进行文档综合优化...",
    outputMessage: "文档综合优化草稿已生成",
    temperature: 0.4,
    preserveStructure: false,
  },
};

export function getOptimizeCapability(id: OptimizeCapabilityId): OptimizeCapability {
  return OPTIMIZE_CAPABILITIES[id];
}
