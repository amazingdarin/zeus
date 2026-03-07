import type { JSONContent } from "@tiptap/core";
import type { TraceContext } from "../../../observability/index.js";

export const OPTIMIZE_STYLE_VALUES = [
  "professional",
  "concise",
  "friendly",
  "academic",
  "technical",
  "marketing",
] as const;

export type OptimizeStyle = (typeof OPTIMIZE_STYLE_VALUES)[number];

export type OptimizeCapabilityId =
  | "doc-optimize-format"
  | "doc-optimize-content"
  | "doc-optimize-style"
  | "doc-optimize-full";

export type DocOptimizeArgs = {
  docId: string;
  instructions?: string;
  style?: string;
};

export type DocOptimizeRunInput = {
  userId: string;
  projectKey: string;
  capabilityId: OptimizeCapabilityId;
  args: DocOptimizeArgs;
  traceContext?: TraceContext;
};

export type DocOptimizeRunResult = {
  docId: string;
  title: string;
  parentId: string | null;
  originalContent: JSONContent;
  proposedContent: JSONContent;
};

export type DocOptimizeRunChunk =
  | { type: "thinking"; content: string }
  | { type: "delta"; content: string }
  | { type: "result"; result: DocOptimizeRunResult };
