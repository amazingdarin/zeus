import type { JSONContent } from "@tiptap/core";

import { extractTiptapDoc } from "../../utils/tiptap-content.js";
import {
  fixCommonIssues,
  ensureBlockIds as ensureBlockIdsDeep,
  validateTiptapContent,
} from "./validator.js";
import type { DraftValidationIssue, DraftValidationPolicy } from "./types.js";

export type DocGuardPolicy = DraftValidationPolicy;
export type DocGuardIssue = DraftValidationIssue;

export type DocGuardResult = {
  passed: boolean;
  policy: DocGuardPolicy;
  fixedProposed: JSONContent;
  issues: DocGuardIssue[];
  feedback?: string;
  protocolPassed: boolean;
  additivePassed?: boolean;
};

export function inferPolicy(input: {
  skillLegacyName: string;
  userMessage: string;
  args: Record<string, unknown>;
}): DocGuardPolicy {
  if (input.skillLegacyName === "doc-summary") {
    return "additive_strict";
  }

  const parts: string[] = [];
  if (input.userMessage) parts.push(input.userMessage);

  for (const key of ["instructions", "description", "request", "input"]) {
    const value = input.args[key];
    if (typeof value === "string" && value.trim()) {
      parts.push(value.trim());
    }
  }

  const text = parts.join("\n");
  const lower = text.toLowerCase();

  const addKeywords = [
    "添加",
    "补充",
    "插入",
    "新增",
    "追加",
    "增加",
    "append",
    "insert",
    "supplement",
    "add",
  ];
  const deleteKeywords = [
    "删除",
    "移除",
    "改写",
    "重写",
    "替换",
    "remove",
    "delete",
    "rewrite",
    "replace",
  ];

  const addHit = addKeywords.some((k) => (/[a-z]/.test(k) ? lower.includes(k) : text.includes(k)));
  const deleteHit = deleteKeywords.some((k) => (/[a-z]/.test(k) ? lower.includes(k) : text.includes(k)));

  return addHit && !deleteHit ? "additive_strict" : "protocol_only";
}

export function runDocGuard(input: {
  policy: DocGuardPolicy;
  originalDoc?: JSONContent | null;
  proposedDoc: unknown;
}): DocGuardResult {
  const issues: DocGuardIssue[] = [];

  const extractedProposed = extractTiptapDoc(input.proposedDoc);

  // Pre-validation: detect unknown node/mark types even if common-fix removes them.
  // We treat unknown node/mark as hard errors, per Zeus doc protocol requirements.
  const preValidation = validateTiptapContent(extractedProposed);
  let hasUnknownTypeIssues = false;
  for (const warn of preValidation.warnings) {
    const isUnknownNode = warn.includes("Unknown node type");
    const isUnknownMark = warn.includes("Unknown mark type");
    if (isUnknownNode || isUnknownMark) {
      hasUnknownTypeIssues = true;
      issues.push({
        severity: "error",
        code: isUnknownNode ? "protocol_unknown_node_type" : "protocol_unknown_mark_type",
        message: warn,
      });
    }
  }

  const fixedProposed0 = fixCommonIssues(extractedProposed);
  const fixedProposed: JSONContent = {
    ...fixedProposed0,
    content: ensureBlockIdsDeep(Array.isArray(fixedProposed0.content) ? fixedProposed0.content : []),
  };

  const protocolValidation = validateTiptapContent(fixedProposed);
  let protocolPassed = protocolValidation.errors.length === 0 && !hasUnknownTypeIssues;

  for (const err of protocolValidation.errors) {
    issues.push({
      severity: "error",
      code: "protocol_error",
      message: err,
    });
  }

  for (const warn of protocolValidation.warnings) {
    const isUnknownNode = warn.includes("Unknown node type");
    const isUnknownMark = warn.includes("Unknown mark type");
    if (isUnknownNode || isUnknownMark) {
      protocolPassed = false;
      issues.push({
        severity: "error",
        code: isUnknownNode ? "protocol_unknown_node_type" : "protocol_unknown_mark_type",
        message: warn,
      });
    } else {
      issues.push({
        severity: "warning",
        code: "protocol_warning",
        message: warn,
      });
    }
  }

  let additivePassed: boolean | undefined;
  let missingIds: string[] = [];
  let modifiedIds: string[] = [];

  if (input.policy === "additive_strict") {
    if (!input.originalDoc) {
      additivePassed = true;
    } else {
      const extractedOriginal = extractTiptapDoc(input.originalDoc);
      const summaryIds = getSummarySubtreeIds(extractedOriginal);

      const originalMap = collectBlockSignatures(extractedOriginal);
      const proposedMap = collectBlockSignatures(fixedProposed);

      for (const [id, originalSig] of originalMap) {
        if (summaryIds.has(id)) continue;
        const proposedSig = proposedMap.get(id);
        if (!proposedSig) {
          missingIds.push(id);
          continue;
        }
        if (proposedSig !== originalSig) {
          modifiedIds.push(id);
        }
      }

      if (missingIds.length > 0) {
        issues.push({
          severity: "error",
          code: "additive_deleted_blocks",
          message: `检测到原有 block 被删除: ${missingIds.length} 个`,
          details: { sampleIds: missingIds.slice(0, 10) },
        });
      }

      if (modifiedIds.length > 0) {
        issues.push({
          severity: "error",
          code: "additive_modified_blocks",
          message: `检测到原有 block 被修改: ${modifiedIds.length} 个`,
          details: { sampleIds: modifiedIds.slice(0, 10) },
        });
      }

      additivePassed = missingIds.length === 0 && modifiedIds.length === 0;
    }
  }

  const passed = protocolPassed && (input.policy === "protocol_only" || additivePassed === true);
  const feedback = passed
    ? undefined
    : buildFeedback({
        policy: input.policy,
        protocolPassed,
        additivePassed,
        issues,
        missingIds,
        modifiedIds,
      });

  return {
    passed,
    policy: input.policy,
    fixedProposed,
    issues,
    feedback,
    protocolPassed,
    additivePassed,
  };
}

function normalizeId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function stableStringify(value: Record<string, unknown>): string {
  const keys = Object.keys(value).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of keys) {
    sorted[key] = value[key];
  }
  return JSON.stringify(sorted);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isBlockNode(node: JSONContent): boolean {
  return Boolean(normalizeId((node.attrs as Record<string, unknown> | undefined)?.id));
}

function blockTextExcludingNestedBlocks(node: JSONContent, isRootBlock: boolean): string {
  if (!node || typeof node !== "object") return "";

  if (!isRootBlock && isBlockNode(node)) {
    // Nested blocks are accounted for by their own signatures.
    return "";
  }

  if (node.type === "text") {
    const value = (node as { text?: unknown }).text;
    return typeof value === "string" ? value : "";
  }

  if (!Array.isArray(node.content)) {
    return "";
  }

  let out = "";
  for (const child of node.content) {
    out += blockTextExcludingNestedBlocks(child as JSONContent, false);
  }
  return out;
}

function blockSignature(node: JSONContent): string {
  const attrs = (node.attrs && typeof node.attrs === "object")
    ? (node.attrs as Record<string, unknown>)
    : {};
  const attrsWithoutId: Record<string, unknown> = { ...attrs };
  delete attrsWithoutId.id;
  const attrsSig = stableStringify(attrsWithoutId);
  const textSig = normalizeText(blockTextExcludingNestedBlocks(node, true));
  return `${node.type ?? ""}|${attrsSig}|${textSig}`;
}

function collectBlockSignatures(doc: JSONContent): Map<string, string> {
  const map = new Map<string, string>();

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const json = node as JSONContent;
    const id = normalizeId((json.attrs as Record<string, unknown> | undefined)?.id);
    if (id) {
      map.set(id, blockSignature(json));
    }
    if (Array.isArray(json.content)) {
      for (const child of json.content) {
        visit(child);
      }
    }
  };

  visit(doc);
  return map;
}

function isSummaryBlock(block: JSONContent | undefined): boolean {
  if (!block || block.type !== "blockquote") return false;
  const firstPara = (block.content as JSONContent[] | undefined)?.[0];
  if (firstPara?.type !== "paragraph") return false;
  const firstText = (firstPara.content as JSONContent[] | undefined)?.[0];
  if (firstText?.type !== "text") return false;
  const text = (firstText as { text?: string }).text || "";
  return text.startsWith("📝 摘要：") || text.startsWith("📁 目录摘要：");
}

function getSummarySubtreeIds(doc: JSONContent): Set<string> {
  if (doc.type !== "doc" || !Array.isArray(doc.content) || doc.content.length === 0) {
    return new Set();
  }

  const firstBlock = doc.content[0] as JSONContent | undefined;
  if (!isSummaryBlock(firstBlock)) {
    return new Set();
  }

  const ids = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const json = node as JSONContent;
    const id = normalizeId((json.attrs as Record<string, unknown> | undefined)?.id);
    if (id) ids.add(id);
    if (Array.isArray(json.content)) {
      for (const child of json.content) {
        visit(child);
      }
    }
  };
  visit(firstBlock);
  return ids;
}

function buildFeedback(input: {
  policy: DocGuardPolicy;
  protocolPassed: boolean;
  additivePassed?: boolean;
  issues: DocGuardIssue[];
  missingIds: string[];
  modifiedIds: string[];
}): string {
  const lines: string[] = [];
  lines.push("【校验反馈】请严格按以下要求重新生成输出：");
  lines.push("1) 只输出最终的 Tiptap JSON（根节点必须是 {\"type\":\"doc\",\"content\":[...]}），不要输出 Markdown 或解释文字。");
  lines.push("2) 必须保留所有原有 block 的 attrs.id；新增 block 必须生成新的 id。");

  if (input.policy === "additive_strict") {
    lines.push("3) 这是“添加/补充”类请求：除顶部摘要块（文本以“📝 摘要：”或“📁 目录摘要：”开头）允许替换外，禁止删除或修改任何原有 block。");
  }

  if (!input.protocolPassed) {
    const protocolErrors = input.issues
      .filter((i) => i.severity === "error" && i.code.startsWith("protocol_"))
      .slice(0, 5)
      .map((i) => `- ${i.message}`);
    if (protocolErrors.length > 0) {
      lines.push("协议问题：");
      lines.push(...protocolErrors);
    }
  }

  if (input.policy === "additive_strict" && input.additivePassed === false) {
    if (input.missingIds.length > 0) {
      lines.push(`原有 block 被删除：${input.missingIds.length} 个（示例：${input.missingIds.slice(0, 8).join(", ")}）`);
    }
    if (input.modifiedIds.length > 0) {
      lines.push(`原有 block 被修改：${input.modifiedIds.length} 个（示例：${input.modifiedIds.slice(0, 8).join(", ")}）`);
    }
  }

  lines.push("请基于原始文档完整保留内容，仅实现用户提出的目标改动。");
  return lines.join("\n");
}
